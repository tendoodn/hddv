/* AutoTax V3.2: admin MST assignments. Requires admin.html's client, esc, fmt and msg helpers. */
async function loadMstAssignments(){
 const {data,error}=await client.rpc("addon_admin_list_mst_assignments");
 if(error){msg("msg","Không tải được MST: "+error.message,true);return;}
 const body=document.getElementById("mstAssignments");
 body.replaceChildren();
 for(const a of data||[]){
  const tr=document.createElement("tr");
  for(const value of [a.email,a.mst,fmt(a.assigned_at)]){
   const td=document.createElement("td");td.textContent=value||"—";tr.append(td);
  }
  const td=document.createElement("td"),btn=document.createElement("button");
  btn.className="danger";btn.textContent="Gỡ MST";
  btn.addEventListener("click",async()=>{
   if(!confirm("Gỡ MST "+a.mst+" của "+a.email+"?"))return;
   btn.disabled=true;
   const {error}=await client.rpc("addon_unlink_mst",{p_mst:a.mst,p_user_id:a.user_id});
   if(error){msg("msg",error.message,true);btn.disabled=false;return;}
   msg("msg","Đã gỡ liên kết MST; lịch sử dùng thử được giữ nguyên.");
   await loadMstAssignments();
  });
  td.append(btn);tr.append(td);body.append(tr);
 }
 if(!body.children.length){const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.textContent="Chưa có MST liên kết.";tr.append(td);body.append(tr);}
}
document.getElementById("reloadMst")?.addEventListener("click",loadMstAssignments);
