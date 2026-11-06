/* AutoTax V1.1.18 team management. Quota and MST usage are enforced by authenticated Supabase RPCs. */
(()=>{
'use strict';
const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const db=window.AutoTaxSharedClient||window.supabase?.createClient(BASE,KEY);
const $=id=>document.getElementById(id);
let teams=[],memberships=[],myId='',activeTeam='',myMsts=[],editingPerson=null,leaderEntitlements=null;
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=String(text);if(className)node.className=className;return node};
const notice=(msg,error=false)=>{const n=$('autotaxTeamMessage');n.hidden=!msg;n.textContent=msg||'';n.classList.toggle('error',!!error)};
const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data};
const friendly=e=>{const s=String(e?.message||e||'Không rõ lỗi');return ({user_not_registered:'Người dùng chưa tạo tài khoản AutoTax.',team_limit_reached:'Đã đạt giới hạn 50 nhóm.',not_team_owner:'Chỉ trưởng nhóm được thao tác.',team_access_denied:'Bạn không có quyền xem nhóm.',invalid_modes:'Chế độ sử dụng không hợp lệ.'})[s]||s};
const current=()=>teams.find(t=>t.id===activeTeam);
let syncingPasswordGrants=false,teamDetailRequest=0,lastTeamRefreshAt=0;
async function syncPendingTeamPasswords(){
 if(syncingPasswordGrants||!teams.some(t=>t.owner_id===myId))return;
 syncingPasswordGrants=true;
 try{
  const pending=await rpc('autotax_team_passwords_needing_sync_v121');
  let synced=0,missing=0;
  for(const mst of Array.isArray(pending)?pending:[]){
   let password=null;
   try{password=await window.AutoTaxSharedMstVault?.get?.(mst)}
   catch(e){console.warn('Kho mật khẩu trưởng nhóm đang khóa:',e.message)}
   if(password){
    await window.AutoTaxTeamShared.syncOwnedPassword(mst,password);
    synced++;
   }else missing++;
  }
  if(synced)notice('Đã đồng bộ tự động mật khẩu HĐĐT cho '+synced+' MST nhóm.');
  if(missing)notice('Có '+missing+' MST nhóm chưa có mật khẩu đồng bộ. Mở phân quyền thành viên và lưu để cấp mật khẩu.',true);
 }catch(error){console.warn('Chưa đồng bộ được mật khẩu MST nhóm:',error.message)}
 finally{syncingPasswordGrants=false}
}

// A team grants independently selected quota modes and selected MST profile access.
async function renderSharedMstPanel(){
 const detail=$('autotaxTeamDetail');
 let panel=$('autotaxTeamSharedPasswords');
 if(!panel){
  panel=make('section',null,'panel autotax-team-shared-passwords');
  panel.id='autotaxTeamSharedPasswords';detail?.append(panel);
 }
 panel.replaceChildren();
 panel.append(make('h3','Hồ sơ MST trưởng nhóm chia sẻ'));
 try{
  const profiles=(await window.AutoTaxTeamShared?.list?.()||[])
   .filter(p=>p.team_id===activeTeam);
  if(!profiles.length){
   panel.append(make('p','Chưa có MST nào được chia sẻ cho tài khoản này.','muted'));
   return;
  }
  for(const profile of profiles){
   const item=make('div',null,'autotax-team-shared-row');
   item.append(make('span',profile.mst+' · '+(profile.display_name||'Hồ sơ được chia sẻ')));
   const rights=profile.can_use_mst_package?
     'Được sử dụng hạn mức MST nhóm':profile.can_use_invoice_package?
     'Được sử dụng hạn mức Số tờ nhóm':'Hồ sơ MST được chia sẻ';
   const credential=profile.password_shared===true?'Mật khẩu HĐĐT đã được cấp':'Chưa được cấp mật khẩu HĐĐT';
   item.append(make('small',rights+' · '+credential,'muted'));
   panel.append(item);
  }
 }catch(error){panel.append(make('p','Không tải được hồ sơ MST nhóm: '+error.message,'muted'))}
}

function showTab(team){
 const dash=$('dashboard');if(dash.hidden)return;
 dash.classList.toggle('autotax-team-active',team);
 $('autotaxTeamPanel').hidden=!team;
 $('autotaxBasicTab').classList.toggle('is-active',!team);
 $('autotaxTeamTab').classList.toggle('is-active',team);
 $('autotaxBasicTab').setAttribute('aria-selected',String(!team));
 $('autotaxTeamTab').setAttribute('aria-selected',String(team));
 // A view switch must not re-fetch and rebuild the member table every time.
 if(team&&Date.now()-lastTeamRefreshAt>45000)void refresh();
}
async function refresh(){
 if(!db)return;
 try{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.user){myId='';teams=[];memberships=[];activeTeam='';lastTeamRefreshAt=0;$('autotaxTeamDetail').hidden=true;return}
  myId=session.user.id;
  const requestedUserId=myId;
  const [tr,mr,pr,er]=await Promise.all([
   db.from('autotax_teams_v118').select('id,name,owner_id,created_at').order('created_at'),
   db.from('autotax_team_members_v118').select('team_id,user_id,status').eq('user_id',myId),
   db.from('addon_mst_assignments').select('mst,display_name').eq('user_id',myId),
   db.rpc('autotax_my_entitlements_v118')
  ]);
  // Ignore a stale response if sign-out or account switching happened
  // while group RPCs were in flight. Never paint the previous user's teams.
  const {data:{session:currentSession}}=await db.auth.getSession();
  if(myId!==requestedUserId||currentSession?.user?.id!==requestedUserId)return;
  leaderEntitlements=er.error?null:er.data;
  if(tr.error)throw tr.error;if(mr.error)throw mr.error;
  teams=tr.data||[];memberships=mr.data||[];myMsts=pr.error?[]:(pr.data||[]);
  lastTeamRefreshAt=Date.now();
  renderTeams();
  // Prioritize the visible member list; optional credential maintenance begins
  // only after the group panel has been drawn.
  if(activeTeam&&teams.some(t=>t.id===activeTeam))await showDetail(activeTeam);
  else {$('autotaxTeamDetail').hidden=true;activeTeam=''}
  void syncPendingTeamPasswords();
 }catch(e){notice(friendly(e),true)}
}
function renderTeams(){
 const owned=teams.filter(t=>t.owner_id===myId).length;
 $('autotaxTeamCount').textContent=owned+'/50 nhóm đã tạo';
 $('autotaxTeamNew').disabled=owned>=50;
 const list=$('autotaxTeamList');list.replaceChildren();
 const invites=$('autotaxTeamInvitations');invites.replaceChildren();
 for(const team of teams){
  const mine=team.owner_id===myId;
  const membership=memberships.find(m=>m.team_id===team.id&&m.user_id===myId);
  if(!mine&&membership?.status==='invited'){
   const box=make('div',null,'notice');
   box.append(make('span','Lời mời tham gia nhóm: '+team.name+' '));
   const accept=make('button','Chấp nhận tham gia nhóm');
   accept.type='button';accept.addEventListener('click',()=>run(async()=>{await rpc('autotax_team_accept_v118',{p_team:team.id});notice('Đã tham gia nhóm.');await refresh()}));
   box.append(accept);invites.append(box);
   continue;
  }
  const b=make('button',team.name+(mine?' · Trưởng nhóm':' · Thành viên'),'secondary autotax-team-button');
  b.type='button';
  b.setAttribute('aria-controls','autotaxTeamDetail');
  const expanded=activeTeam===team.id&&!$('autotaxTeamDetail').hidden;
  b.setAttribute('aria-expanded',String(expanded));
  b.classList.toggle('is-active',expanded);
  b.addEventListener('click',()=>run(async()=>{
   const detail=$('autotaxTeamDetail');
   if(activeTeam===team.id&&!detail.hidden){
    detail.hidden=true;activeTeam='';editingPerson=null;teamDetailRequest++;
    $('autotaxTeamPermissionDialog')?.close();
    renderTeams();
    return;
   }
   await showDetail(team.id);
   renderTeams();
  }));
  list.append(b);
 }
 if(!teams.length)list.append(make('p','Chưa có nhóm. Bấm + Tạo thêm nhóm để bắt đầu.','muted'));
}
function modeCheck(value,label,selected,disabled){
 const wrap=make('label'),box=make('input');
 box.type='checkbox';box.value=value;box.checked=selected;box.disabled=disabled;
 wrap.append(box,make('span',label));return wrap;
}
async function showDetail(id){
 const team=teams.find(t=>t.id===id);if(!team)return;
 activeTeam=id;const owner=team.owner_id===myId;
 $('autotaxTeamDetail').hidden=false;
 // Chỉ nút nhóm hiển thị tên và vai trò; không lặp lại dòng tiêu đề đen.
 $('autotaxTeamDetailTitle').textContent='';
 $('autotaxTeamDetailTitle').hidden=true;
 $('autotaxTeamInviteForm').hidden=!owner;
 $('autotaxTeamLeave').hidden=owner;
 $('autotaxTeamUsageTab').hidden=!owner;
 $('autotaxTeamMembersTab').hidden=!owner;
 $('autotaxTeamUsagePanel').hidden=true;
 $('autotaxTeamMembersPanel').hidden=false;
 $('autotaxTeamMembersBody').closest('table').querySelectorAll('thead th').forEach((th,i)=>{th.hidden=!owner&&i!==0});
 const detailRequest=++teamDetailRequest;
 // Start both requests together, but don't make the member list wait for the
 // slower history query. The usage counters are filled in when ready.
 const usageLater=(owner?rpc('autotax_team_usage_stats_v118',{p_team:id}):Promise.resolve([]))
  .then(data=>({data})).catch(error=>({error}));
 const people=await rpc('autotax_team_people_v118',{p_team:id});
 if(detailRequest!==teamDetailRequest||activeTeam!==id||$('autotaxTeamDetail').hidden)return;
 const tbody=$('autotaxTeamMembersBody'),usage=$('autotaxTeamUsageBody');
 const usageRows=new Map();
 tbody.replaceChildren();usage.replaceChildren();
 const allPeople=[...people];
 for(const person of allPeople){
  const tr=make('tr');const name=make('td',person.display_name||'—');
  if(!owner){tr.append(name);tbody.append(tr);continue}
  const email=make('td',person.email||'—');
  const modes=make('td'),msts=make('td'),actions=make('td');
  const modeValues=Array.isArray(person.allowed_modes)?person.allowed_modes:[];
  const mstValues=Array.isArray(person.allowed_msts)?person.allowed_msts:[];
  const openEditor=section=>{
   editingPerson=person;
   $('autotaxTeamPermissionTitle').textContent='Phân quyền · '+(person.display_name||person.email);
   const ownInvoice=Number(leaderEntitlements?.packages?.invoice?.purchased||0)>0;
   const ownMst=Number(leaderEntitlements?.packages?.mst?.active_quantity||0)>0;
   const leaderModes=[...(ownMst?['mst']:[]),...(ownInvoice?['invoice']:[])];
   const dualPlan=ownInvoice&&ownMst;
   const preferredMode=leaderModes.includes(leaderEntitlements?.mode)?leaderEntitlements.mode:leaderModes[0];
   $('autotaxTeamPermissionModes').closest('.autotax-permission-field').hidden=!dualPlan;
   $('autotaxTeamPermissionHelp').textContent=dualPlan?
     'Chỉ những MST được trưởng nhóm tick chia sẻ mới được sử dụng gói MST hoặc Số tờ của nhóm (theo chế độ được cấp). MST thành viên tự nhập, không có trong danh sách chia sẻ, luôn dùng hạn mức cá nhân.':
     'Quyền nhóm chỉ áp dụng cho MST được trưởng nhóm tick chia sẻ. MST khác do thành viên tự nhập sử dụng hạn mức cá nhân.';
   const mc=$('autotaxTeamPermissionModes'),sc=$('autotaxTeamPermissionMsts');
   mc.replaceChildren();sc.replaceChildren();
   for(const [value,label] of [['mst','MST'],['invoice','Số tờ']]){
    if(!leaderModes.includes(value))continue;
    mc.append(modeCheck(value,label,dualPlan?
      (modeValues.length?modeValues.includes(value):value===preferredMode):true,false));
   }
   const allowedMsts=[...new Set([...myMsts.map(x=>x.mst),...mstValues])].filter(Boolean);
   for(const mst of allowedMsts){
    const label=myMsts.find(x=>x.mst===mst)?.display_name;
    sc.append(modeCheck(mst,mst+(label?' · '+label:''),mstValues.includes(mst),false));
   }
   if(!allowedMsts.length)sc.append(make('span','Chưa có MST nào được trưởng nhóm quản lý.','muted'));
   $('autotaxTeamPermissionStatus').hidden=true;
   $('autotaxTeamPermissionDialog').showModal();
   (section==='mst'?sc:mc).querySelector('input')?.focus();
  };
  const gear=(cell,section,summary)=>{
   const btn=make('button','⚙','secondary');btn.type='button';
   btn.title='Thiết lập '+(section==='mst'?'MST':'hình thức sử dụng');
   btn.setAttribute('aria-label',btn.title+' cho '+(person.display_name||person.email));
   btn.addEventListener('click',()=>openEditor(section));
   cell.append(btn,make('span',summary,'muted'));
  };
  gear(modes,'mode',modeValues.map(x=>x==='invoice'?'Số tờ':'MST').join(', ')||'Chưa cấp');
  gear(msts,'mst',mstValues.length?mstValues.length+' MST':'Chưa cấp');
  const remove=make('button','Xóa khỏi nhóm','secondary');remove.type='button';
  remove.addEventListener('click',()=>{if(!confirm('Xóa '+(person.email||'thành viên')+' khỏi nhóm?'))return;void run(async()=>{await rpc('autotax_team_remove_v118',{p_team:id,p_user:person.user_id});notice('Đã xóa thành viên.');await showDetail(id)})});
  actions.append(remove);
  tr.append(name,email,modes,msts,actions);tbody.append(tr);
  const used=make('tr');
  used.append(make('td',person.display_name||'—'),make('td',person.email||'—'),
   make('td','Đang tải…'),make('td','Đang tải…'));
  usage.append(used);usageRows.set(person.user_id,used);
 }
 if(!allPeople.length)tbody.append(make('tr',''));
 if(owner)$('autotaxTeamSharedPasswords')?.remove();
 else void renderSharedMstPanel();
 void usageLater.then(({data,error})=>{
  if(detailRequest!==teamDetailRequest||activeTeam!==id||$('autotaxTeamDetail').hidden)return;
  if(error){console.warn('Chưa lấy được thống kê nhóm:',error.message);return;}
  const byMember=new Map((data||[]).map(x=>[x.user_id,x]));
  for(const [userId,row] of usageRows){
   const counts=byMember.get(userId)||{invoice_count:0,mst_count:0};
   row.children[2].textContent=Number(counts.invoice_count||0).toLocaleString('vi-VN');
   row.children[3].textContent=Number(counts.mst_count||0).toLocaleString('vi-VN');
  }
 });
}
$('autotaxTeamPermissionClose').addEventListener('click',()=>$('autotaxTeamPermissionDialog').close());
$('autotaxTeamPermissionForm').addEventListener('submit',e=>{
 e.preventDefault();if(!editingPerson)return;
 void run(async()=>{
  const btn=$('autotaxTeamPermissionSave');btn.disabled=true;
  const selected=id=>[...$(id).querySelectorAll('input:checked')].map(x=>x.value);
  try{
   const msts=selected('autotaxTeamPermissionMsts'),teamId=activeTeam;
   const modes=selected('autotaxTeamPermissionModes');
   // Keep the Save action independent of secret retrieval. The follow-up
   // checks the server for only MSTs that still lack shared credentials.
   $('autotaxTeamPermissionStatus').hidden=false;
   $('autotaxTeamPermissionStatus').classList.remove('error');
   $('autotaxTeamPermissionStatus').textContent='Đang lưu quyền thành viên lên máy chủ…';
   const updated=await rpc('autotax_team_set_permissions_v118',{
    p_team:teamId,p_user:editingPerson.user_id,
    p_modes:modes,p_msts:msts
   });
   if(updated!==true)throw Error('Chưa ghi được quyền thành viên. Vui lòng thử lại.');
   // The permission transaction is committed. Do not hold up the Save button
   // for rebuilding two tables or for multiple tax-password vault requests.
   $('autotaxTeamPermissionDialog').close();editingPerson=null;
   notice('Đã lưu quyền thành viên. Danh sách và mật khẩu nhóm đang được đồng bộ.');
   void showDetail(teamId).catch(err=>notice('Quyền đã lưu; chưa làm mới được danh sách: '+friendly(err),true));
   if(modes.length&&msts.length){
    void (async()=>{
     // Missing-credential lookup includes existing grants as well as new ones,
     // but avoids retransmitting passwords that have already been shared.
     const pending=await rpc('autotax_team_passwords_needing_sync_v121');
     const missing=msts.filter(mst=>(Array.isArray(pending)?pending:[]).includes(mst));
     if(!missing.length)return;
     const shared=await shareGrantedPasswords(teamId,missing);
     if(shared.skipped)notice('Quyền đã lưu; '+shared.skipped+' MST vẫn chưa có mật khẩu chia sẻ.',true);
     else if(shared.updated)notice('Đã lưu quyền và cập nhật mật khẩu cho '+shared.updated+' MST.');
    })().catch(err=>notice('Quyền đã lưu nhưng chưa kiểm tra được mật khẩu MST: '+friendly(err),true));
   }
  }catch(err){
   const el=$('autotaxTeamPermissionStatus');el.hidden=false;
   el.textContent=friendly(err);el.classList.add('error');
  }finally{btn.disabled=false}
 });
});
// Passwords are explicitly shared by the leader, then encrypted in the
// private server vault; members can fetch only their currently shared MSTs.
async function askTeamPassword(mst){
 return new Promise(resolve=>{
  const dlg=document.createElement('dialog');
  dlg.className='autotax-signup-dialog';
  const form=document.createElement('form');form.method='dialog';
  const label=make('label','Mật khẩu HĐĐT của MST '+mst+' (để thành viên sử dụng)');
  const input=document.createElement('input');input.type='password';
  input.autocomplete='off';input.maxLength=256;input.required=true;
  label.append(input);
  const hint=make('p','Mật khẩu sẽ được mã hóa trên máy chủ và chỉ cấp cho thành viên đang được chia sẻ MST này.','muted');
  const actions=make('div',null,'actions');
  const save=make('button','Cấp mật khẩu');save.type='submit';
  const cancel=make('button','Bỏ qua','secondary');cancel.type='button';
  cancel.addEventListener('click',()=>dlg.close('cancel'));
  actions.append(save,cancel);form.append(label,hint,actions);dlg.append(form);
  document.body.append(dlg);
  form.addEventListener('submit',event=>{
   event.preventDefault();if(!input.value)return;
   const pwd=input.value;input.value='';
   dlg.addEventListener('close',()=>{dlg.remove();resolve(pwd)},{once:true});
   dlg.close('save');
  });
  dlg.addEventListener('close',()=>{if(!dlg.isConnected)return;dlg.remove();resolve(null)},{once:true});
  dlg.showModal();input.focus();
 });
}
async function shareGrantedPasswords(teamId,msts){
 let updated=0,skipped=0;
 for(const mst of [...new Set(msts)]){
  let password=null;
  try{password=await window.AutoTaxSharedMstVault?.get?.(mst)}
  catch(error){console.warn('Kho mật khẩu của trưởng nhóm chưa mở:',error.message)}
  if(!password)password=await askTeamPassword(mst);
  if(!password){skipped++;continue}
  await window.AutoTaxTeamShared.sharePassword(teamId,mst,password);
  updated++;
 }
 return {updated,skipped};
}
async function run(fn){try{await fn()}catch(e){notice(friendly(e),true)}}
$('autotaxBasicTab').addEventListener('click',()=>showTab(false));
$('autotaxTeamTab').addEventListener('click',()=>showTab(true));
$('autotaxTeamRefresh').addEventListener('click',()=>void refresh());
$('autotaxTeamNew').addEventListener('click',()=>{$('autotaxTeamCreateForm').hidden=false;$('autotaxTeamName').focus()});
$('autotaxTeamCancel').addEventListener('click',()=>{$('autotaxTeamCreateForm').hidden=true});
$('autotaxTeamCreateForm').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
 const id=await rpc('autotax_team_create_v118',{p_name:$('autotaxTeamName').value.trim()});
 $('autotaxTeamName').value='';$('autotaxTeamCreateForm').hidden=true;
 notice('Đã tạo nhóm.');await refresh();await showDetail(id);
})});
$('autotaxTeamInviteForm').addEventListener('submit',e=>{e.preventDefault();void run(async()=>{
 const outcome=await rpc('autotax_team_invite_v118',{p_team:activeTeam,p_email:$('autotaxTeamInviteEmail').value.trim()});
 $('autotaxTeamInviteEmail').value='';
 notice(outcome==='already_member'?'Thành viên đã vào nhóm.':outcome==='already_invited'?'Đã mời trước đó, đang chờ xác nhận.':'Đã gửi lời mời, vui lòng chờ thành viên chấp nhận.');
 await showDetail(activeTeam);
})});
$('autotaxTeamLeave').addEventListener('click',()=>{if(!confirm('Rời nhóm này?'))return;void run(async()=>{await rpc('autotax_team_leave_v118',{p_team:activeTeam});activeTeam='';notice('Đã rời nhóm.');await refresh()})});
$('autotaxTeamMembersTab').addEventListener('click',()=>{$('autotaxTeamMembersPanel').hidden=false;$('autotaxTeamUsagePanel').hidden=true});
$('autotaxTeamUsageTab').addEventListener('click',()=>{$('autotaxTeamMembersPanel').hidden=true;$('autotaxTeamUsagePanel').hidden=false});
// Repeated SIGNED_IN on tab focus is NOT a new team session. Do not rebuild
// member tables or lose the currently selected controls on every tab switch.
db?.auth.onAuthStateChange((event,nextSession)=>{
 const nextUser=nextSession?.user?.id||'';
 if(event==='SIGNED_OUT'){
  myId='';teams=[];memberships=[];activeTeam='';lastTeamRefreshAt=0;
  $('autotaxTeamDetail').hidden=true;
  return;
 }
 if(event==='SIGNED_IN'&&nextUser&&myId&&nextUser!==myId){
  myId=nextUser;lastTeamRefreshAt=0;
  if(!$('autotaxTeamPanel').hidden)queueMicrotask(()=>void refresh());
 }
});
})();