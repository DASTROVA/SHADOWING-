/* DASTROV STUDIO — local-first learning app.
   Video blobs are stored in IndexedDB. Progress and vocabulary use localStorage. */
const DB_NAME="dastrovStudioDB", DB_VERSION=1, STORE="videos";
let db=null, activeUrl=null, activeRecord=null, currentLine=-1;
let mediaRecorder=null, recordedChunks=[], recognition=null, recordingStream=null;
let practiceSeconds=0, practiceStart=null, flashIndex=0, flashRevealed=false;
const $=id=>document.getElementById(id);
const state=loadState();

function loadState(){
  try{return JSON.parse(localStorage.getItem("dastrovState")||"{}")}catch{return {}}
}
function saveState(){localStorage.setItem("dastrovState",JSON.stringify(state))}
function toast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:"id",autoIncrement:true})};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error)})}
function store(mode="readonly"){return db.transaction(STORE,mode).objectStore(STORE)}
function addVideo(data){return new Promise((res,rej)=>{const r=store("readwrite").add(data);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function allVideos(){return new Promise((res,rej)=>{const r=store().getAll();r.onsuccess=()=>res(r.result.sort((a,b)=>b.createdAt-a.createdAt));r.onerror=()=>rej(r.error)})}
function removeVideo(id){return new Promise((res,rej)=>{const r=store("readwrite").delete(Number(id));r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function bytes(n){return n>1024**3?(n/1024**3).toFixed(1)+" GB":(n/1024**2).toFixed(1)+" MB"}
function date(ts){return new Intl.DateTimeFormat("uz-UZ",{day:"numeric",month:"short",year:"numeric"}).format(new Date(ts))}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function navigate(page){document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+page));document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("pageCrumb").textContent=({home:"Dashboard",studio:"Shadowing Studio",library:"My videos",vocabulary:"Vocabulary",progress:"My progress"})[page]||"Dashboard";$("sidebar").classList.remove("open");if(page==="progress")renderProgress();if(page==="vocabulary")renderWords();window.scrollTo({top:0,behavior:"smooth"})}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
$("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));

function ensureDay(){const today=new Date().toISOString().slice(0,10);if(state.lastActive!==today){const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);state.streak=state.lastActive===yesterday?(state.streak||0)+1:1;state.lastActive=today;saveState()}}
function addXP(n){state.xp=(state.xp||0)+n;saveState();renderStats()}
function renderStats(){
 const mins=Math.floor((state.totalSeconds||0)/60);
 $("dashMinutes").innerHTML=`${mins} <small>min</small>`;$("dashVideos").textContent=state.videoCount||0;$("dashXP").textContent=state.xp||0;$("dashStreak").innerHTML=`${state.streak||0} <small>days</small>`;
}
function releaseUrl(){if(activeUrl)URL.revokeObjectURL(activeUrl);activeUrl=null}
function clearVideo(){const v=$("videoPlayer");v.pause();v.removeAttribute("src");v.load();v.hidden=true;$("videoEmpty").hidden=false;$("activeVideoName").textContent="Hali video tanlanmagan";$("activeVideoSize").textContent="Telefoningizdan video tanlang";$("videoInfo").textContent="Video tanlanmagan";releaseUrl();activeRecord=null}
async function setVideo(record){
 releaseUrl();activeRecord=record;activeUrl=URL.createObjectURL(record.file);const v=$("videoPlayer");v.src=activeUrl;v.hidden=false;$("videoEmpty").hidden=true;$("activeVideoName").textContent=record.name;$("activeVideoSize").textContent=`${bytes(record.size)} • ${date(record.createdAt)}`;$("videoInfo").textContent=record.name;v.load();navigate("studio");toast("Video ochildi. Mashqni boshlashingiz mumkin.");
}
$("videoFile").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("video/")){toast("Video fayl tanlang.");e.target.value="";return}
 try{const record={name:file.name,type:file.type,size:file.size,createdAt:Date.now(),file};record.id=await addVideo(record);state.videoCount=(state.videoCount||0)+1;saveState();await setVideo(record);await renderVideos();renderStats()}
 catch(err){console.error(err);toast("Video saqlanmadi. Telefon xotirasi yoki brauzer ruxsatini tekshiring.")}
 e.target.value="";
});
$("removeActive").addEventListener("click",clearVideo);
$("speedSelect").addEventListener("change",e=>$("videoPlayer").playbackRate=Number(e.target.value));
$("repeatSentence").addEventListener("click",()=>{const line=getLines()[currentLine];if(!line){toast("Avval transkriptdan gap tanlang.");return}seekLine(line);$("loopSentence").checked=true;$("videoPlayer").play().catch(()=>{});});
$("videoPlayer").addEventListener("timeupdate",()=>{
 const v=$("videoPlayer"),lines=getLines();if($("loopSentence").checked&&currentLine>=0){const line=lines[currentLine],next=lines[currentLine+1];if(line&&v.currentTime>(next?next.time:v.duration)){v.currentTime=line.time;}}
 const active=lines.reduce((best,l,i)=>l.time<=v.currentTime?i:best,-1);if(active!==currentLine&&active>=0)highlightLine(active,false);
 if(!v.paused){if(!practiceStart)practiceStart=Date.now();if(Date.now()-practiceStart>=1000){state.totalSeconds=(state.totalSeconds||0)+1;practiceStart=Date.now();saveState();renderStats()}}
});
$("videoPlayer").addEventListener("pause",()=>{practiceStart=null});
$("videoPlayer").addEventListener("ended",()=>{state.sessions=(state.sessions||0)+1;addXP(10);saveState();renderStats();toast("Mashg‘ulot yakunlandi! +10 XP")});

function getLines(){return Array.isArray(state.transcript)?state.transcript:[]}
function renderTranscript(){
 const list=$("transcriptList"),lines=getLines();list.innerHTML="";
 if(!lines.length){list.innerHTML='<div class="transcript-empty">Hozircha gaplar yo‘q. “Add sentence” tugmasi orqali birinchi gapni kiriting.</div>';return}
 lines.forEach((line,i)=>{
  const row=document.createElement("div");row.className="transcript-row"+(i===currentLine?" active":"");row.dataset.index=i;
  const time=document.createElement("input");time.className="time-input";time.type="number";time.min="0";time.step=".1";time.value=line.time;time.title="Boshlanish vaqti (sekund)";
  time.addEventListener("change",()=>{line.time=Math.max(0,Number(time.value)||0);state.transcript=lines.sort((a,b)=>a.time-b.time);saveState();renderTranscript()});
  const text=document.createElement("input");text.type="text";text.value=line.text;text.placeholder="English sentence";text.setAttribute("aria-label","Gap matni");
  text.addEventListener("change",()=>{line.text=text.value;saveState();updateCurrentSentence()});
  const speak=document.createElement("button");speak.type="button";speak.textContent="▶";speak.title="Gapni ovoz chiqarib o‘qish";speak.addEventListener("click",e=>{e.stopPropagation();if(!line.text.trim()){toast("Avval gap matnini kiriting.");return}if(!("speechSynthesis" in window)){toast("Bu brauzer ovoz chiqarib o‘qishni qo‘llamaydi.");return}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(line.text);utterance.lang="en-US";utterance.rate=.88;speechSynthesis.speak(utterance)});
  const del=document.createElement("button");del.type="button";del.textContent="×";del.title="Gapni o‘chirish";del.addEventListener("click",()=>{state.transcript=lines.filter((_,n)=>n!==i);currentLine=-1;saveState();renderTranscript();updateCurrentSentence()});
  row.addEventListener("click",e=>{if(e.target===time||e.target===text||e.target===del||e.target===speak)return;highlightLine(i,true)});
  row.append(time,text,speak,del);list.append(row);
 });
}
function highlightLine(i,seek){currentLine=i;const lines=getLines();document.querySelectorAll(".transcript-row").forEach((r,n)=>r.classList.toggle("active",n===i));updateCurrentSentence();if(seek&&lines[i]){seekLine(lines[i]);$("videoPlayer").play().catch(()=>{})}}
function seekLine(line){const v=$("videoPlayer");if(!v.src){toast("Avval video yuklang.");return}v.currentTime=Number(line.time)||0}
function updateCurrentSentence(){const l=getLines()[currentLine];$("currentSentence").textContent=l?l.text:"Mashq qilish uchun transkriptdan gap tanlang."}
$("addLine").addEventListener("click",()=>{const lines=getLines();const last=lines.at(-1);lines.push({time:last?Number(last.time)+4:0,text:""});state.transcript=lines;saveState();renderTranscript();const inputs=$("transcriptList").querySelectorAll('input[type="text"]');inputs[inputs.length-1]?.focus()});
$("saveTranscript").addEventListener("click",()=>{state.transcript=getLines();saveState();addXP(2);toast("Transkript saqlandi. +2 XP")});
$("exportTranscript").addEventListener("click",()=>{const data=getLines().map(l=>`${Number(l.time).toFixed(1)}\t${l.text}`).join("\n");downloadText("dastrov-transcript.txt",data);});
function downloadText(name,content){const a=document.createElement("a"),url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}

$("recordBtn").addEventListener("click",async()=>{
 if(mediaRecorder?.state==="recording"){mediaRecorder.stop();$("recordBtn").classList.remove("recording");$("recordBtn").innerHTML="<span>●</span> Record my voice";return}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast("Bu brauzer audio yozishni qo‘llamaydi.");return}
 try{recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});recordedChunks=[];mediaRecorder=new MediaRecorder(recordingStream);mediaRecorder.ondataavailable=e=>{if(e.data.size)recordedChunks.push(e.data)};mediaRecorder.onstop=()=>{const blob=new Blob(recordedChunks,{type:mediaRecorder.mimeType||"audio/webm"});$("recordingPlayback").src=URL.createObjectURL(blob);$("recordingPlayback").hidden=false;recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;toast("Ovoz yozuvi tayyor. Tinglab ko‘ring.")};mediaRecorder.start();$("recordBtn").classList.add("recording");$("recordBtn").innerHTML="<span>●</span> Stop recording"}
 catch(err){console.error(err);toast("Mikrofon ruxsati berilmadi yoki sahifa HTTPS emas.")}
});
$("speechBtn").addEventListener("click",()=>{
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast("Speech recognition bu brauzerda mavjud emas. Chrome'da sinab ko‘ring.");return}
 if(recognition){recognition.stop();recognition=null;return}
 recognition=new SR();recognition.lang="en-US";recognition.interimResults=true;recognition.continuous=false;
 $("speechResult").textContent="Tinglayapman... Gapiring.";
 recognition.onresult=e=>{let text="";for(let i=e.resultIndex;i<e.results.length;i++)text+=e.results[i][0].transcript;$("speechResult").textContent=text;$("typedAnswer").value=text};
 recognition.onerror=e=>{$("speechResult").textContent="Nutqni aniqlash xatosi: "+e.error};
 recognition.onend=()=>{recognition=null};recognition.start();
});
function normalize(s){return s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu," ").replace(/\s+/g," ").trim()}
$("checkAnswer").addEventListener("click",()=>{
 const target=getLines()[currentLine]?.text||"";const answer=$("typedAnswer").value;if(!target){toast("Avval transkript gapini tanlang.");return}if(!answer.trim()){toast("Javobingizni yozing yoki Speak to text tugmasidan foydalaning.");return}
 const a=normalize(target).split(" "),b=normalize(answer).split(" "),correct=a.filter((w,i)=>b[i]===w).length,score=Math.round(correct/Math.max(a.length,b.length,1)*100);
 $("compareResult").innerHTML=`<b>${score}% matn mosligi</b> — ${correct}/${a.length} ta so‘z joyida mos tushdi. <span>${score>=85?"Juda yaxshi!":score>=55?"Yana bir marta mashq qiling.":"Sekinroq tinglab, qayta urinib ko‘ring."}</span>`;
 if(score>=85)addXP(5);
});
/* Vocabulary and flashcards */
function words(){return Array.isArray(state.words)?state.words:[]}
function renderWords(){
 const grid=$("vocabGrid"),arr=words();$("wordCount").textContent=`${arr.length} WORDS`;grid.innerHTML="";
 if(!arr.length){grid.innerHTML='<div class="empty-library"><span>Aa</span><b>Hozircha so‘zlar yo‘q</b><small>Yuqoridagi maydon orqali so‘z qo‘shing.</small></div>';return}
 arr.forEach((w,i)=>{const card=document.createElement("article");card.className="word-card";card.innerHTML=`<b>${escapeHTML(w.word)}</b><div class="meaning">${escapeHTML(w.meaning)}</div><p>${escapeHTML(w.example||"")}</p><button data-remove-word="${i}">Remove word ×</button>`;grid.append(card)});
 grid.querySelectorAll("[data-remove-word]").forEach(b=>b.addEventListener("click",()=>{state.words=words().filter((_,i)=>i!==Number(b.dataset.removeWord));saveState();renderWords()}));
}
$("addWord").addEventListener("click",()=>{const word=$("newWord").value.trim(),meaning=$("newMeaning").value.trim(),example=$("newExample").value.trim();if(!word||!meaning){toast("So‘z va tarjimani kiriting.");return}state.words=words();state.words.unshift({word,meaning,example});saveState();$("newWord").value=$("newMeaning").value=$("newExample").value="";renderWords();addXP(2);toast("So‘z saqlandi. +2 XP")});
function showFlash(){const arr=words();if(!arr.length){toast("Avval lug‘atga so‘z qo‘shing.");return}$("flashcardArea").hidden=false;flashRevealed=false;const w=arr[flashIndex%arr.length];$("flashWord").textContent=w.word;$("flashMeaning").textContent=flashRevealed?w.meaning:"Tarjimasini eslashga harakat qiling."; $("flipCard").textContent=flashRevealed?"Hide meaning":"Show meaning"}
$("flashcardBtn").addEventListener("click",()=>{flashIndex=0;showFlash();$("flashcardArea").scrollIntoView({behavior:"smooth"})});
$("flipCard").addEventListener("click",()=>{flashRevealed=!flashRevealed;showFlash()});
$("nextCard").addEventListener("click",()=>{flashIndex++;showFlash();addXP(1)});
$("prevCard").addEventListener("click",()=>{flashIndex=Math.max(0,flashIndex-1);showFlash()});
/* Library */
async function renderVideos(){
 const videos=await allVideos(),query=($("videoSearch")?.value||"").toLowerCase();$("libraryCount").textContent=`${videos.length} videos`;
 const grid=$("libraryGrid");if(!grid)return;grid.innerHTML="";
 const filtered=videos.filter(v=>v.name.toLowerCase().includes(query));
 if(!filtered.length){grid.innerHTML='<div class="empty-library"><span>▤</span><b>Kutubxona bo‘sh</b><small>Video yuklasangiz shu yerda ko‘rinadi.</small></div>'}
 filtered.forEach(v=>{const card=document.createElement("article");card.className="video-card";card.innerHTML=`<div class="video-thumb">▷</div><div class="video-card-body"><b title="${escapeHTML(v.name)}">${escapeHTML(v.name)}</b><small>${bytes(v.size)} • ${date(v.createdAt)}</small><div class="video-card-actions"><button data-open="${v.id}">Open</button><button data-delete="${v.id}">Delete</button></div></div>`;card.querySelector(".video-thumb").addEventListener("click",()=>setVideo(v));card.querySelector("[data-open]").addEventListener("click",()=>setVideo(v));card.querySelector("[data-delete]").addEventListener("click",async()=>{if(confirm("Videoni kutubxonadan o‘chirasizmi?")){await removeVideo(v.id);if(activeRecord?.id===v.id)clearVideo();state.videoCount=Math.max(0,(state.videoCount||1)-1);saveState();renderVideos();renderStats()}});grid.append(card)});
 const recent=$("recentVideos");if(recent){recent.innerHTML="";if(!videos.length)recent.innerHTML='<div class="empty-small">Hozircha video yo‘q. Shadowing Studio orqali birinchi videoni yuklang.</div>';videos.slice(0,3).forEach(v=>{const c=document.createElement("div");c.className="recent-card";c.innerHTML=`<div class="recent-thumb">▷</div><div><b>${escapeHTML(v.name)}</b><small>${bytes(v.size)}</small></div>`;c.addEventListener("click",()=>setVideo(v));recent.append(c)})}
}
$("videoSearch").addEventListener("input",renderVideos);
/* Progress view */
function renderProgress(){
 const mins=Math.floor((state.totalSeconds||0)/60);$("progressXP").textContent=state.xp||0;$("progressMinutes").textContent=mins;$("progressSessions").textContent=state.sessions||0;$("progressStreak").textContent=state.streak||0;
 const chart=$("weekChart");chart.innerHTML="";const labels=["Du","Se","Ch","Pa","Ju","Sh","Ya"];const today=new Date().getDay();const activeIndex=(today+6)%7;const vals=state.weekActivity||[0,0,0,0,0,0,0];labels.forEach((day,i)=>{const wrap=document.createElement("div");wrap.className="day-bar"+(i===activeIndex?" today":"");const bar=document.createElement("div");bar.className="bar";bar.style.height=Math.max(5,Math.min(100,vals[i]||0))+"%";const lab=document.createElement("small");lab.textContent=day;wrap.append(bar,lab);chart.append(wrap)});
 const ach=$("achievementList");const items=[["🌱","First steps","1 ta video yuklang",(state.videoCount||0)>=1],["✦","Word collector","5 ta so‘z saqlang",words().length>=5],["🔥","Consistency","3 kunlik streak",(state.streak||0)>=3],["🎧","Focused learner","30 daqiqa mashq qiling",mins>=30],["🏁","Practice starter","1 mashg‘ulot yakunlang",(state.sessions||0)>=1],["⭐","XP explorer","100 XP to‘plang",(state.xp||0)>=100]];ach.innerHTML="";items.forEach(([icon,title,desc,done])=>{const el=document.createElement("div");el.className="achievement";el.innerHTML=`<span class="medal">${icon}</span><div><b>${title}${done?" ✓":""}</b><small>${desc}</small></div>`;ach.append(el)});
}
/* daily practice activity record */
function updateActivity(){const day=(new Date().getDay()+6)%7;state.weekActivity=state.weekActivity||[0,0,0,0,0,0,0];state.weekActivity[day]=Math.min(100,(state.weekActivity[day]||0)+1);saveState()}
$("videoPlayer").addEventListener("play",()=>{ensureDay();updateActivity()});
window.addEventListener("beforeunload",()=>{releaseUrl();if(recordingStream)recordingStream.getTracks().forEach(t=>t.stop())});
(async function init(){
 ensureDay();state.transcript=state.transcript||[];state.words=state.words||[];saveState();renderStats();renderTranscript();renderWords();
 try{if(!("indexedDB" in window))throw new Error("IndexedDB unsupported");await openDB();const videos=await allVideos();state.videoCount=videos.length;saveState();renderStats();await renderVideos()}
 catch(e){console.error(e);toast("Brauzer xotirasi ochilmadi. Chrome yoki boshqa zamonaviy brauzerda sinang.")}
})();
