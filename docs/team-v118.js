/* AutoTax V1.1.18 team management. Quota and MST usage are enforced by authenticated Supabase RPCs. */
(()=>{
'use strict';
const BASE='https://ucqqjdsoyvvaxswzbhaw.supabase.co';
const KEY='sb_publishable_7zUjUap6EkHJZ0Gp12vesw_UY-yB7jJ';
const db=window.supabase?.createClient(BASE,KEY);
const $=id=>document.getElementById(id);
let teams=[],memberships=[],myId='',activeTeam='',myMsts=[];
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=String(text);if(className)node.className=className;return node};
const notice=(msg,error=false)=>{const n=$('autotaxTeamMessage');n.hidden=!msg;n.textContent=msg||'';n.classList.toggle('error',!!error)};
const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data};
const friendly=e=>{const s=String(e?.message||e||'Không rõ lỗi');return ({user_not_registered:'Người dùng chưa tạo tài khoản AutoTax.',team_limit_reached:'Đã đạt giới hạn 50 nhóm.',not_team_owner:'Chỉ trưởng nhóm được thao tác.',team_access_denied:'Bạn không có quyền xem nhóm.',invalid_modes:'Chế độ sử dụng không hợp lệ.'})[s]||s};
const current=()=>teams.find(t=>t.id===activeTeam);
function showTab(team){
 const dash=$('dashboard');if(dash.hidden)return;
 dash.classList.toggle('autotax-team-active',team);
 $('autotaxTeamPanel').hidden=!team;
 $('autotaxBasicTab').classList.toggle('is-active',!team);
 $('autotaxTeamTab').classList.toggle('is-active',team);
 $('autotaxBasicTab').setAttribute('aria-selected',String(!team));
 $('autotaxTeamTab').setAttribute('aria-selected',String(team));
 if(team)void refresh();
}
async function refresh(){
 if(!db)return;
 try{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.user){myId='';teams=[];memberships=[];activeTeam='';$('autotaxTeamDetail').hidden=true;return}
  myId=session.user.id;
  const [tr,mr,pr]=await Promise.all([
   db.from('autotax_teams_v118').select('id,name,owner_id,created_at').order('created_at'),
   db.from('autotax_team_members_v118').select('team_id,user_id,status').eq('user_id',myId),
   db.from('addon_mst_assignments').select('mst,display_name').eq('user_id',myId)
  ]);
  if(tr.error)throw tr.error;if(mr.error)throw mr.error;
  teams=tr.data||[];memberships=mr.data||[];myMsts=pr.error?[]:(pr.data||[]);
  renderTeams();
  if(activeTeam&&teams.some(t=>t.id===activeTeam))await showDetail(activeTeam);
  else {$('autotaxTeamDetail').hidden=true;activeTeam=''}
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
  const b=make('button',team.name+(mine?' · Trưởng nhóm':' · Thành viên'),'secondary');
  b.type='button';b.addEventListener('click',()=>run(()=>showDetail(team.id)));
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
 $('autotaxTeamDetailTitle').textContent=team.name+(owner?' · Trưởng nhóm':' · Thành viên');
 $('autotaxTeamInviteForm').hidden=!owner;
 $('autotaxTeamLeave').hidden=owner;
 const [people,usageStats]=await Promise.all([
  rpc('autotax_team_people_v118',{p_team:id}),
  rpc('autotax_team_usage_stats_v118',{p_team:id})
 ]);
 const usageByMember=new Map((usageStats||[]).map(x=>[x.user_id,x]));
 const tbody=$('autotaxTeamMembersBody'),usage=$('autotaxTeamUsageBody');
 tbody.replaceChildren();usage.replaceChildren();
 const allPeople=[...people];
 for(const person of allPeople){
  const tr=make('tr');const name=make('td',person.display_name||'—');
  const email=make('td',person.email||'—');
  const modes=make('td'),msts=make('td'),actions=make('td');
  const editing=()=>actions.dataset.editing==='true';
  const modeValues=Array.isArray(person.allowed_modes)?person.allowed_modes:[];
  const mstValues=Array.isArray(person.allowed_msts)?person.allowed_msts:[];
  for(const [value,label] of [['mst','MST'],['invoice','Số tờ']])modes.append(modeCheck(value,label,modeValues.includes(value),true));
  const allMsts=[...new Set([...myMsts.map(x=>x.mst),...mstValues])].filter(Boolean);
  if(allMsts.length)for(const mst of allMsts){
   const label=myMsts.find(x=>x.mst===mst)?.display_name;
   msts.append(modeCheck(mst,mst+(label?' · '+label:''),mstValues.includes(mst),true));
  }
  else msts.append(make('span','Chưa có MST được cấp','muted'));
  if(owner){
   const edit=make('button','Sửa quyền','secondary'),save=make('button','Lưu');
   edit.type='button';save.type='button';save.hidden=true;
   edit.addEventListener('click',()=>{
    actions.dataset.editing='true';for(const box of tr.querySelectorAll('input[type=checkbox]'))box.disabled=false;
    edit.hidden=true;save.hidden=false;
   });
   save.addEventListener('click',()=>run(async()=>{
    const selected=cell=>[...cell.querySelectorAll('input:checked')].map(x=>x.value);
    await rpc('autotax_team_set_permissions_v118',{p_team:id,p_user:person.user_id,p_modes:selected(modes),p_msts:selected(msts)});
    notice('Đã lưu và khóa quyền.');await showDetail(id);
   }));
   const remove=make('button','Xóa khỏi nhóm','secondary');remove.type='button';
   remove.addEventListener('click',()=>{if(!confirm('Xóa '+(person.email||'thành viên')+' khỏi nhóm?'))return;void run(async()=>{await rpc('autotax_team_remove_v118',{p_team:id,p_user:person.user_id});notice('Đã xóa thành viên.');await showDetail(id)})});
   actions.append(edit,save,remove);
  }else actions.append(make('span','Chỉ xem','muted'));
  tr.append(name,email,modes,msts,actions);tbody.append(tr);
  const used=make('tr');
  const counts=usageByMember.get(person.user_id)||{invoice_count:0,mst_count:0};
  used.append(make('td',person.display_name||'—'),make('td',person.email||'—'),
   make('td',Number(counts.invoice_count||0).toLocaleString('vi-VN')),
   make('td',Number(counts.mst_count||0).toLocaleString('vi-VN')));
  usage.append(used);
 }
 if(!allPeople.length)tbody.append(make('tr',''));
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
 await rpc('autotax_team_invite_v118',{p_team:activeTeam,p_email:$('autotaxTeamInviteEmail').value.trim()});
 $('autotaxTeamInviteEmail').value='';notice('Đã gửi lời mời.');await showDetail(activeTeam);
})});
$('autotaxTeamLeave').addEventListener('click',()=>{if(!confirm('Rời nhóm này?'))return;void run(async()=>{await rpc('autotax_team_leave_v118',{p_team:activeTeam});activeTeam='';notice('Đã rời nhóm.');await refresh()})});
$('autotaxTeamMembersTab').addEventListener('click',()=>{$('autotaxTeamMembersPanel').hidden=false;$('autotaxTeamUsagePanel').hidden=true});
$('autotaxTeamUsageTab').addEventListener('click',()=>{$('autotaxTeamMembersPanel').hidden=true;$('autotaxTeamUsagePanel').hidden=false});
db?.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT'){if(!$('autotaxTeamPanel').hidden)queueMicrotask(()=>void refresh());}});
})();