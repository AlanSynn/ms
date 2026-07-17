import { writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((value, index, values) =>
    value.startsWith("--") ? [[value.slice(2), values[index + 1]]] : [],
  ),
);
const endpoint = (args.endpoint || "https://alansynn.com/ms-study/v1").replace(/\/+$/, "");
const deployment = args.deployment;
const session = args.session;
const output = args.out || `study-replay-${session || "session"}.html`;
const selectedContext = args.context;
const token = process.env.STUDY_ADMIN_TOKEN;

if (!deployment || !session || !token) {
  console.error("Usage: STUDY_ADMIN_TOKEN=... bun scripts/study-replay.ts --deployment v0.0.9 --session ses_... [--context ctx_...] [--endpoint URL] [--out replay.html] [--force]");
  process.exit(1);
}

const adminFetch = async (path: string) => {
  const response = await fetch(`${endpoint}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response;
};

type SessionPage = {
  batches: Array<{
    contextId: string;
    participantId: string;
    sessionId: string;
    records: Array<Record<string, unknown>>;
  }>;
  assets: Array<{ key: string; size: number; metadata?: Record<string, string> }>;
  cursor?: string | null;
};

const pages: SessionPage[] = [];
let cursor = "";
do {
  const query = new URLSearchParams({ deployment, ...(cursor ? { cursor } : {}) });
  const page = await (await adminFetch(`/admin/session/${encodeURIComponent(session)}?${query}`)).json() as SessionPage;
  pages.push(page);
  cursor = page.cursor || "";
} while (cursor);

const rawEvents = pages.flatMap((page) =>
  page.batches
    .filter((batch) => !selectedContext || batch.contextId === selectedContext)
    .flatMap((batch) => batch.records.map((record) => ({
      ...record,
      contextId: batch.contextId,
      participantId: batch.participantId,
    }))),
).sort((a, b) =>
  Number(a.t) - Number(b.t) || String(a.contextId).localeCompare(String(b.contextId)) || Number(a.seq) - Number(b.seq),
);

const chunked = new Map<string, {
  reason: string;
  total: number;
  chunks: Array<Uint8Array | undefined>;
}>();
const events: Array<Record<string, unknown>> = [];
for (const event of rawEvents) {
  const data = event.data as Record<string, unknown> | undefined;
  if (event.type === "project.snapshot.begin" && data && typeof data.snapshotId === "string" && Number.isSafeInteger(data.total)) {
    chunked.set(`${event.contextId}\0${data.snapshotId}`, {
      reason: typeof data.reason === "string" ? data.reason : "chunked",
      total: Number(data.total),
      chunks: Array.from({ length: Number(data.total) }),
    });
    continue;
  }
  if (event.type === "project.snapshot.chunk" && data && typeof data.snapshotId === "string" && Array.isArray(data.parts)) {
    const chunkKey = `${event.contextId}\0${data.snapshotId}`;
    const pending = chunked.get(chunkKey);
    const index = Number(data.index);
    if (!pending || !Number.isSafeInteger(index) || index < 0 || index >= pending.total) continue;
    pending.chunks[index] = Buffer.from(data.parts.join(""), "base64url");
    if (pending.chunks.every(Boolean)) {
      try {
        const state = JSON.parse(Buffer.concat(pending.chunks as Uint8Array[]).toString("utf8"));
        events.push({
          ...event,
          type: "project.snapshot",
          data: { reason: pending.reason, state },
        });
      } catch {
        // Corrupt/incomplete research records do not block the rest of a replay.
      }
      chunked.delete(chunkKey);
    }
    continue;
  }
  events.push(event);
}

const assetEntries = [...new Map(
  pages.flatMap((page) => page.assets).map((asset) => [asset.key, asset]),
).values()];
const embeddedAssets: Array<{ key: string; type: string; data: string; metadata?: Record<string, string> }> = [];
let embeddedBytes = 0;
for (const asset of assetEntries) {
  if (embeddedAssets.length >= 32 || embeddedBytes + asset.size > 20 * 1024 * 1024) break;
  const response = await adminFetch(`/admin/object?key=${encodeURIComponent(asset.key)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  embeddedBytes += bytes.byteLength;
  embeddedAssets.push({
    key: asset.key,
    type: response.headers.get("content-type") || "application/octet-stream",
    data: Buffer.from(bytes).toString("base64"),
    metadata: asset.metadata,
  });
}

const payload = JSON.stringify({ deployment, session, events, assets: embeddedAssets })
  .replace(/</g, "\\u003c");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MotionSmith Study Replay</title>
<style>
*{box-sizing:border-box}body{margin:0;font:14px system-ui;background:#f5f7fb;color:#172033}header{padding:14px 18px;background:#172033;color:white;display:flex;gap:18px;align-items:center}header b{font-size:18px}.layout{display:grid;grid-template-columns:minmax(520px,2fr) minmax(340px,1fr);height:calc(100vh - 56px)}main,aside{min-height:0;overflow:auto;padding:16px}aside{border-left:1px solid #dbe1ea;background:white}canvas{width:100%;aspect-ratio:16/10;background:white;border:1px solid #ccd5e2;border-radius:12px}.controls{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin:12px 0}.event{padding:8px 10px;border-left:3px solid #8b5cf6;background:#f7f3ff;margin:5px 0}.event.active{background:#e9ddff}.muted{color:#657189}.pill{display:inline-block;background:#e8edf5;padding:3px 8px;border-radius:99px;margin-right:6px}pre{white-space:pre-wrap;word-break:break-word;background:#101725;color:#dbe8ff;padding:12px;border-radius:10px;max-height:44vh;overflow:auto}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}.gallery img{width:100%;aspect-ratio:1;object-fit:contain;background:#eef1f6;border-radius:8px}@media(max-width:900px){.layout{display:block;height:auto}aside{border:0}}
</style></head><body>
<header><b>MotionSmith Study Replay</b><span>${deployment}</span><span>${session}</span><span>${selectedContext || "all contexts"}</span><span id="summary"></span></header>
<div class="layout"><main><canvas id="scene" width="1200" height="750"></canvas><div class="controls"><button id="prev">Prev</button><input id="slider" type="range" min="0" max="${Math.max(0, events.length - 1)}" value="0"><button id="next">Next</button></div><div id="current"></div><h3>Imported visuals</h3><div class="gallery" id="gallery"></div></main><aside><h3>Timeline</h3><div id="timeline"></div><h3>Record</h3><pre id="detail"></pre></aside></div>
<script>const data=${payload};
const slider=document.querySelector('#slider'),ctx=document.querySelector('#scene').getContext('2d');
const time=ms=>{const s=Math.floor(Number(ms||0)/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
function values(value){return value&&typeof value==='object'?Object.values(value):[]}
function point(value){return value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?value:null}
function without(object,id){const next={...(object||{})};delete next[id];return next}
function rebuiltSkeleton(previous,joints){const bones=[],rootJointIds=[],hierarchy={},jointMap={};values(joints).forEach(joint=>{if(joint.parentId&&joints[joint.parentId]){bones.push([joint.parentId,joint.id]);(hierarchy[joint.parentId]||=[]).push(joint.id)}else rootJointIds.push(joint.id);jointMap[String(joint.name||joint.id).replaceAll(' ','_')]=joint.id});return {...(previous||{}),joints,bones,rootJointIds,hierarchy,jointMap,metadata:previous&&previous.metadata||{}}}
function applyAction(state,action){if(!state||!action||typeof action!=='object')return state;const parts=state.parts||{},objects=state.sceneObjects||{},paths=state.paths||{},mechanisms=state.mechanisms||[];switch(action.type){
case 'set_processing':return {...state,processing:action.processing};
case 'select_part':{const path=values(paths).find(item=>!item.sceneObjectId&&item.partId===action.partId);return {...state,selectedPartId:action.partId,selectedSceneObjectId:undefined,selectedPathId:path&&path.id}}
case 'select_scene_object':{const path=values(paths).find(item=>item.sceneObjectId===action.objectId);return {...state,selectedSceneObjectId:action.objectId,selectedPartId:action.objectId?undefined:state.selectedPartId,selectedPathId:path&&path.id}}
case 'upsert_part':if(!action.part||!action.part.id)return state;return {...state,parts:{...parts,[action.part.id]:action.part},partOrder:parts[action.part.id]?(state.partOrder||[]):[...(state.partOrder||[]),action.part.id],selectedPartId:action.part.id,selectedSceneObjectId:undefined};
case 'update_part':if(!parts[action.partId])return state;return {...state,parts:{...parts,[action.partId]:{...parts[action.partId],...(action.updates||{})}}};
case 'delete_part':{const removedPaths=Object.fromEntries(Object.entries(paths).filter(([,path])=>path.sceneObjectId||path.partId!==action.partId));return {...state,parts:without(parts,action.partId),partOrder:(state.partOrder||[]).filter(id=>id!==action.partId),paths:removedPaths,selectedPartId:state.selectedPartId===action.partId?(state.partOrder||[]).find(id=>id!==action.partId):state.selectedPartId,selectedPathId:removedPaths[state.selectedPathId]?state.selectedPathId:undefined}}
case 'reorder_part':{const order=[...(state.partOrder||[])],from=order.indexOf(action.partId),to=from+Number(action.direction);if(from<0||to<0||to>=order.length)return state;[order[from],order[to]]=[order[to],order[from]];return {...state,partOrder:order}}
case 'upsert_scene_object':if(!action.object||!action.object.id)return state;return {...state,sceneObjects:{...objects,[action.object.id]:action.object},sceneObjectOrder:objects[action.object.id]?(state.sceneObjectOrder||[]):[...(state.sceneObjectOrder||[]),action.object.id],selectedSceneObjectId:action.object.id,selectedPartId:undefined};
case 'update_scene_object':if(!objects[action.objectId])return state;return {...state,sceneObjects:{...objects,[action.objectId]:{...objects[action.objectId],...(action.updates||{})}}};
case 'delete_scene_object':{const remainingPaths=Object.fromEntries(Object.entries(paths).filter(([,path])=>path.sceneObjectId!==action.objectId));return {...state,sceneObjects:without(objects,action.objectId),sceneObjectOrder:(state.sceneObjectOrder||[]).filter(id=>id!==action.objectId),paths:remainingPaths,selectedSceneObjectId:state.selectedSceneObjectId===action.objectId?undefined:state.selectedSceneObjectId,selectedPathId:remainingPaths[state.selectedPathId]?state.selectedPathId:undefined}}
case 'set_skeleton':return {...state,skeleton:action.skeleton};
case 'update_joint':if(!state.skeleton||!state.skeleton.joints[action.jointId])return state;return {...state,skeleton:rebuiltSkeleton(state.skeleton,{...state.skeleton.joints,[action.jointId]:{...state.skeleton.joints[action.jointId],...(action.updates||{})}})};
case 'add_joint':if(!action.joint||!action.joint.id)return state;return {...state,skeleton:rebuiltSkeleton(state.skeleton,{...(state.skeleton&&state.skeleton.joints||{}),[action.joint.id]:action.joint})};
case 'remove_joint':{if(!state.skeleton)return state;const remove=new Set([action.jointId]);let changed=true;while(changed){changed=false;values(state.skeleton.joints).forEach(joint=>{if(joint.parentId&&remove.has(joint.parentId)&&!remove.has(joint.id)){remove.add(joint.id);changed=true}})}return {...state,skeleton:rebuiltSkeleton(state.skeleton,Object.fromEntries(Object.entries(state.skeleton.joints).filter(([id])=>!remove.has(id))))}}
case 'upsert_path':if(!action.path||!action.path.id)return state;return {...state,paths:{...paths,[action.path.id]:action.path},selectedPathId:action.path.id};
case 'delete_path':return {...state,paths:without(paths,action.pathId),selectedPathId:state.selectedPathId===action.pathId?undefined:state.selectedPathId};
case 'set_mechanisms':return {...state,mechanisms:Array.isArray(action.mechanisms)?action.mechanisms:mechanisms,selectedMechanismId:action.selectedMechanismId||state.selectedMechanismId};
case 'upsert_mechanism':{if(!action.mechanism||!action.mechanism.id)return state;const replaced=action.replaceMechanismId&&mechanisms.find(item=>item.id===action.replaceMechanismId),mechanism=replaced?{...action.mechanism,id:replaced.id}:action.mechanism,exists=mechanisms.some(item=>item.id===mechanism.id);return {...state,mechanisms:exists?mechanisms.map(item=>item.id===mechanism.id?mechanism:item):[...mechanisms,mechanism],selectedMechanismId:mechanism.id}}
case 'commit_mechanism_candidate':{const result=action.result,mechanism=result&&result.status!=='blocked'&&result.mechanism;if(!mechanism||!mechanism.id)return state;const exists=mechanisms.some(item=>item.id===mechanism.id);return {...state,mechanisms:exists?mechanisms.map(item=>item.id===mechanism.id?mechanism:item):[...mechanisms,mechanism],selectedMechanismId:mechanism.id}}
case 'delete_mechanism':return {...state,mechanisms:mechanisms.filter(item=>item.id!==action.mechanismId),selectedMechanismId:state.selectedMechanismId===action.mechanismId?undefined:state.selectedMechanismId};
case 'update_settings':return {...state,settings:{...(state.settings||{}),...(action.settings||{}),physicalKit:{...(state.settings&&state.settings.physicalKit||{}),...(action.settings&&action.settings.physicalKit||{})}}};
case 'set_export':return {...state,lastExport:action.fabricationPackage};
default:return state}}
const snapshots=[],contexts={};data.events.forEach((event,index)=>{const context=String(event.contextId||'unknown'),view=contexts[context]||=( {state:null,past:[],future:[]} );if(event.type==='project.snapshot'&&event.data&&event.data.state){view.state=event.data.state;view.past=[];view.future=[]}else if(event.type==='project.action'&&view.state){const action=event.data,next=applyAction(view.state,action),undoable=action&&!['set_processing','select_part','set_export','set_foundry_export'].includes(action.type);if(next!==view.state&&undoable)view.past=[...view.past.slice(-79),view.state];view.state=next;view.future=[]}else if(event.type==='project.undo'&&view.past.length){const previous=view.past[view.past.length-1];view.past=view.past.slice(0,-1);view.future=[view.state,...view.future].slice(0,80);view.state=previous}else if(event.type==='project.redo'&&view.future.length){const next=view.future[0];view.future=view.future.slice(1);view.past=[...view.past.slice(-79),view.state];view.state=next}snapshots[index]=view.state});
function draw(index){ctx.clearRect(0,0,1200,750);ctx.save();ctx.translate(600,375);const state=snapshots[index];if(!state){ctx.fillStyle='#64748b';ctx.fillText('No snapshot yet',-50,0);ctx.restore();return}
ctx.lineWidth=3;ctx.strokeStyle='#c4b5fd';values(state.paths).forEach(path=>{if(!Array.isArray(path.points)||!path.points.length)return;ctx.beginPath();path.points.forEach((p,i)=>{const q=point(p);if(!q)return;i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.stroke()});
values(state.sceneObjects).forEach(object=>{const t=object.transform||{},b=object.bounds||{};ctx.save();ctx.translate(t.x||0,t.y||0);ctx.rotate((t.rotation||0)*Math.PI/180);ctx.scale(t.scale||1,t.scale||1);ctx.fillStyle=object.fillColor||'#f59e0b';ctx.globalAlpha=object.opacity??1;ctx.fillRect(-(b.width||40)/2,-(b.height||40)/2,b.width||40,b.height||40);ctx.restore()});
values(state.parts).forEach(part=>{const t=part.transform||{},b=part.bounds||{};ctx.save();ctx.translate(t.x||0,t.y||0);ctx.rotate((t.rotation||0)*Math.PI/180);ctx.scale(t.scale||1,t.scale||1);ctx.fillStyle=part.fillColor||'#8b5cf6';ctx.globalAlpha=part.opacity??.8;ctx.fillRect(-(b.width||30)/2,-(b.height||30)/2,b.width||30,b.height||30);ctx.restore()});
const joints=state.skeleton&&state.skeleton.joints||{};ctx.globalAlpha=1;ctx.strokeStyle='#334155';ctx.lineWidth=2;(state.skeleton&&state.skeleton.bones||[]).forEach(b=>{const a=point(joints[b[0]]&&joints[b[0]].position),c=point(joints[b[1]]&&joints[b[1]].position);if(a&&c){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.stroke()}});values(joints).forEach(j=>{const p=point(j.position);if(!p)return;ctx.fillStyle='#fff';ctx.strokeStyle='#334155';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.stroke()});
values(state.mechanisms).forEach(m=>{ctx.strokeStyle=m.color||'#16a34a';ctx.beginPath();ctx.arc(m.anchorX||0,m.anchorY||0,Math.max(8,m.crankLength||18),0,Math.PI*2);ctx.stroke()});ctx.restore()}
function render(){const index=Number(slider.value),event=data.events[index]||{};draw(index);document.querySelector('#summary').textContent=data.events.length+' records · '+data.assets.length+' visuals';document.querySelector('#current').innerHTML='<span class="pill">'+time(event.t)+'</span><span class="pill">'+String(event.stage||'unknown')+'</span><span class="pill">'+String(event.contextId||'unknown')+'</span><b>'+String(event.type||'empty')+'</b>';document.querySelector('#detail').textContent=JSON.stringify(event,null,2);const start=Math.max(0,index-40),end=Math.min(data.events.length,index+41);document.querySelector('#timeline').innerHTML=data.events.slice(start,end).map((item,offset)=>'<div class="event '+(start+offset===index?'active':'')+'" data-index="'+(start+offset)+'"><span class="muted">'+time(item.t)+' · '+String(item.stage||'')+' · '+String(item.contextId||'')+'</span><br>'+String(item.type)+'</div>').join('');document.querySelectorAll('.event').forEach(el=>el.onclick=()=>{slider.value=el.dataset.index;render()})}
document.querySelector('#prev').onclick=()=>{slider.value=Math.max(0,Number(slider.value)-1);render()};document.querySelector('#next').onclick=()=>{slider.value=Math.min(data.events.length-1,Number(slider.value)+1);render()};slider.oninput=render;document.querySelector('#gallery').innerHTML=data.assets.map(asset=>'<div><img src="data:'+asset.type+';base64,'+asset.data+'"><small>'+String(asset.metadata&&asset.metadata.kind||asset.key)+'</small></div>').join('');render();
</script></body></html>`;

await writeFile(output, html, { mode: 0o600, flag: Object.hasOwn(args, "force") ? "w" : "wx" });
console.log(`${output}: ${events.length} records, ${embeddedAssets.length}/${assetEntries.length} visuals`);
