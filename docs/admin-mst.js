/* AutoTax V3.2: admin MST assignments. Requires admin.html's client, esc, fmt and msg helpers. */
let adminMstRows=[];
function renderMstAssignments(){
 const query=(document.getElementById("mstAssignmentSearch")?.value||"").trim().toLowerCase();
 const filtered=adminMstRows.filter(a=>!query||String(a.mst||"").includes(query)||
  String(a.email||"").toLowerCase().includes(query)||String(a.display_name||"").toLowerCase().includes(query));
 const body=document.getElementById("mstAssignments");
 document.getElementById("mstAssignmentCount").textContent=filtered.length+"/"+adminMstRows.length+" hồ sơ";
 body.replaceChildren();
 for(const a of filtered){
  const tr=document.createElement("tr");
  for(const value of [a.email,a.mst,a.display_name||'Chưa đặt tên',fmt(a.assigned_at)]){
   const td=document.createElement("td");td.textContent=value||"—";tr.append(td);
  }
  const td=document.createElement("td");
  const rename=document.createElement("button");rename.type="button";rename.className="secondary";
  rename.textContent="Đổi tên";
  rename.addEventListener("click",async()=>{
   const entered=prompt("Tên hồ sơ "+a.mst+" của "+a.email+":",a.display_name||"");
   if(entered===null)return;
   if(entered.trim().length>120){msg("msg","Tên tối đa 120 ký tự.",true);return}
   rename.disabled=true;
   const {error}=await client.rpc("addon_admin_set_mst_profile_name",
    {p_user_id:a.user_id,p_mst:a.mst,p_display_name:entered.trim()});
   if(error){msg("msg",error.message,true);rename.disabled=false;return}
   msg("msg","Đã đổi tên hồ sơ cho "+a.email);await loadMstAssignments();
  });
  const btn=document.createElement("button");
  btn.className="danger";btn.textContent="Gỡ MST";
  btn.addEventListener("click",async()=>{
   if(!confirm("Gỡ MST "+a.mst+" của "+a.email+"?"))return;
   btn.disabled=true;
   const {error}=await client.rpc("addon_unlink_mst",{p_mst:a.mst,p_user_id:a.user_id});
   if(error){msg("msg",error.message,true);btn.disabled=false;return;}
   msg("msg","Đã gỡ liên kết MST; lịch sử dùng thử được giữ nguyên.");
   await loadMstAssignments();
  });
  td.append(rename,btn);tr.append(td);body.append(tr);
 }
 if(!body.children.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=5;td.textContent="Chưa có MST liên kết.";tr.append(td);body.append(tr);}
}
async function loadMstAssignments(){
 const {data,error}=await client.rpc("addon_admin_list_mst_assignments");
 if(error){msg("msg","Không tải được MST: "+error.message,true);return;}
 adminMstRows=data||[];
 renderMstAssignments();
}
document.getElementById("reloadMst")?.addEventListener("click",loadMstAssignments);
document.getElementById("mstAssignmentSearch")?.addEventListener("input",renderMstAssignments);
