/* 校园问答助手 —— 交互逻辑
 * 首页为 AI 问答会话；知识库作为第二个标签页，是 AI 回答的事实依据。
 * 本地检索作为 AI 失败时的兜底；用户纠错与反馈仅存本机。
 */
(function(){
  'use strict';
  var KB = window.KB_DATA;
  if(!KB){ document.body.innerHTML='<p style="padding:40px">知识库数据未加载，请确认 data/knowledge-base.js 存在。</p>'; return; }

  var ITEMS = KB.items;
  var CATS  = KB.taxonomy;
  var byId  = {};
  ITEMS.forEach(function(it){ byId[it.id]=it; });

  var icon = window.icon;

  var state = {
    tab:'chat', view:'chat', currentCat:null, search:'',
    context:{lastItem:null,lastCategory:null,lastTopic:null,turns:0},
    aiHistory:[],
    corrections:load('hebau_corrections',{}),
    helpful:load('hebau_helpful',{}),
    feedback:load('hebau_feedback',[])
  };

  function load(k,d){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }
  function save(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }
  function toast(msg){
    var t=$('toast'); t.textContent=msg; t.classList.add('show');
    clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove('show');},2200);
  }
  function scrollChat(){ var c=$('chatScroll'); if(c) c.scrollTop=c.scrollHeight; }

  /* ---------- 多会话本地持久化 ---------- */
  var SESSION_KEY='hebau_chats_v1';
  var sessions=load(SESSION_KEY,null);
  function newSessionObj(){
    return {id:'c'+Date.now()+'_'+Math.random().toString(36).slice(2,7),title:'新对话',
      created:Date.now(),updated:Date.now(),html:'',aiHistory:[],
      context:{lastItem:null,lastCategory:null,lastTopic:null,turns:0},hasChat:false};
  }
  if(!sessions || !sessions.list || !sessions.list.length){
    var s0=newSessionObj(); sessions={list:[s0],currentId:s0.id};
  }
  if(!sessions.list.some(function(s){return s.id===sessions.currentId;})) sessions.currentId=sessions.list[0].id;
  function currentSession(){
    return sessions.list.filter(function(s){return s.id===sessions.currentId;})[0]||sessions.list[0];
  }
  function saveSessions(){
    if(save(SESSION_KEY,sessions)) return;
    while(sessions.list.length>1){
      sessions.list.pop();
      if(save(SESSION_KEY,sessions)) return;
    }
  }
  function persistCurrent(){
    var s=currentSession();
    s.html=$('chatLog').innerHTML;
    s.aiHistory=state.aiHistory.slice(-16);
    s.context={lastItem:state.context.lastItem,lastCategory:state.context.lastCategory,
      lastTopic:state.context.lastTopic,turns:state.context.turns};
    s.hasChat=$('welcome').style.display==='none';
    s.updated=Date.now();
    saveSessions();
  }
  function timeAgo(ts){
    var d=Date.now()-(ts||Date.now());
    if(d<60000) return '刚刚';
    if(d<3600000) return Math.floor(d/60000)+' 分钟前';
    if(d<86400000) return Math.floor(d/3600000)+' 小时前';
    var dt=new Date(ts); return (dt.getMonth()+1)+'月'+dt.getDate()+'日';
  }

  /* ---------- 静态图标 ---------- */
  function paintIcons(){
    $('brandMark').innerHTML=icon('logo');
    $('welcomeMark').innerHTML=icon('sparkle');
    $('btnSend').innerHTML=icon('send');
    $('btnNewChat').innerHTML=icon('plus');
    $('btnChats').innerHTML=icon('list');
    $('closeChats').innerHTML=icon('close');
    $('drawerNewChat').innerHTML=icon('plus')+'<span>新建对话</span>';
    $('btnSettings').innerHTML=icon('settings');
    $('closeSettings').innerHTML=icon('close');
    $('closeFeedback').innerHTML=icon('close');
    $('kbSearchIcon').innerHTML=icon('search');
    $('builtinIco').innerHTML=icon('shield');
    $('detailBack').innerHTML=icon('back')+'<span>返回知识库</span>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-icon]'),function(el){
      el.innerHTML=icon(el.getAttribute('data-icon'));
    });
  }

  /* ---------- 标签与视图 ---------- */
  function switchView(v){
    state.view=v;
    $('chatView').classList.toggle('active',v==='chat');
    $('kbView').classList.toggle('active',v==='kb');
    $('detailView').classList.toggle('active',v==='detail');
  }
  function switchTab(tab){
    state.tab=tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'),function(b){
      b.classList.toggle('active',b.getAttribute('data-tab')===tab);
    });
    switchView(tab);
    if(tab==='chat') scrollChat();
  }
  function goChat(){ switchTab('chat'); }

  /* ---------- 知识库标签 ---------- */
  function catItems(cid){ return CATS.filter(function(c){return c.id===cid;})[0]; }
  function renderCatChips(){
    var h='<button class="cat-chip'+(state.currentCat===null?' active':'')+'" data-cat="">全部</button>';
    CATS.forEach(function(c){
      var n=ITEMS.filter(function(i){return i.category===c.name;}).length;
      if(!n) return;
      h+='<button class="cat-chip'+(state.currentCat===c.id?' active':'')+'" data-cat="'+esc(c.id)+'">'+esc(c.name)+'</button>';
    });
    $('catChips').innerHTML=h;
    Array.prototype.forEach.call($('catChips').querySelectorAll('.cat-chip'),function(b){
      b.onclick=function(){ state.currentCat=b.getAttribute('data-cat')||null; renderCatChips(); renderItems(); };
    });
  }

  function statusTags(it){
    var m={verified:['官网已核实',''],historical:['较早/某年安排','hist'],
      'official-unclear':['官网未明确','unclear'],'other-audience':['特定群体适用','other']};
    var t=m[it.status]||m.verified;
    return '<span class="tag '+t[1]+'">'+t[0]+'</span><span class="tag">核对 '+esc(it.maintenance.last_reviewed)+'</span>';
  }

  function renderItems(){
    var q=(state.search||'').trim().toLowerCase();
    var cat=state.currentCat?catItems(state.currentCat):null;
    var list=ITEMS.filter(function(it){
      if(cat && it.category!==cat.name) return false;
      if(!q) return true;
      var hay=(it.topic+' '+(it.keywords||[]).join(' ')+' '+it.answer.summary+' '+it.id).toLowerCase();
      return hay.indexOf(q)>=0;
    });
    if(!list.length){
      $('itemList').innerHTML='<div class="empty">'+icon('search')+'没有匹配的条目，换个关键词试试</div>';
      return;
    }
    var h='';
    list.forEach(function(it){
      h+='<div class="item-card" data-id="'+esc(it.id)+'">'
        +'<div class="item-cat">'+esc(it.category)+'</div>'
        +'<div class="item-topic">'+esc(it.topic)+'</div>'
        +'<div class="item-sum">'+esc(it.answer.summary)+'</div>'
        +'<div class="item-tags">'+statusTags(it)+'</div></div>';
    });
    $('itemList').innerHTML=h;
    Array.prototype.forEach.call($('itemList').querySelectorAll('.item-card'),function(el){
      el.onclick=function(){ openDetail(el.getAttribute('data-id')); };
    });
  }

  function answerBody(it){
    var corrected=state.corrections[it.id];
    var h='<div class="ans-summary">'+esc(it.answer.summary)+'</div>';
    if(it.answer.details && it.answer.details.length){
      h+='<ul class="ans-details">';
      it.answer.details.forEach(function(d){ h+='<li>'+esc(d)+'</li>'; });
      h+='</ul>';
    }
    if(it.answer.table && it.answer.table.length){
      h+='<table class="detail-table"><thead><tr>';
      it.answer.table[0].forEach(function(c){h+='<th>'+esc(c)+'</th>';});
      h+='</tr></thead><tbody>';
      it.answer.table.slice(1).forEach(function(r){
        h+='<tr>'; r.forEach(function(c){h+='<td>'+esc(c)+'</td>';}); h+='</tr>';
      });
      h+='</tbody></table>';
    }
    if(corrected) h+='<div class="correct-note">用户纠错（仅存本机，待核实）：'+esc(corrected)+'</div>';
    return h;
  }

  function sourceBlock(it){
    var s=it.source;
    var h='<div class="src-box"><div class="src-title">'+icon('link')+'来源：<a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.title)+'</a></div>'
      +'<div>页面更新：'+esc(s.published)+' · 官网核对：'+esc(s.accessed)+'</div>';
    if(it.extra_sources && it.extra_sources.length){
      h+='<div>补充来源：';
      it.extra_sources.forEach(function(x,k){
        if(k) h+='；';
        h+='<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.title)+'</a>';
      });
      h+='</div>';
    }
    if(it.notes) h+='<div>说明：'+esc(it.notes)+'</div>';
    h+='</div>';
    return h;
  }

  function maintBlock(it){
    var m=it.maintenance;
    return '<div class="maint-box"><h4>维护信息</h4>'
      +'<div class="maint-row"><span>最后核对</span><span>'+esc(m.last_reviewed)+'</span></div>'
      +'<div class="maint-row"><span>复核周期</span><span>'+esc(m.review_cycle)+'</span></div>'
      +'<div class="maint-row"><span>启用状态</span><span>'+(m.enabled?'启用':'停用')+'</span></div></div>';
  }

  function openDetail(id){
    var it=byId[id]; if(!it) return;
    $('detailWrap').innerHTML='<div class="detail-path">'+esc(it.category)+' / '+esc(it.topic)+' · '+esc(it.id)+'</div>'
      +'<h2>'+esc(it.topic)+'</h2>'
      +answerBody(it)
      +'<div class="status-line">'+statusTags(it)+'</div>'
      +sourceBlock(it)+maintBlock(it);
    switchView('detail');
  }
  $('detailBack').onclick=function(){ switchView('kb'); };

  /* ---------- 本地问答（AI 失败时的兜底） ---------- */
  function normalize(s){ return String(s||'').toLowerCase().replace(/[\s，。？?！!、,.;：:]/g,''); }
  function charOverlap(a,b){
    if(!a||!b) return 0;
    var seen={},hit=0;
    for(var i=0;i<a.length;i++){ if(seen[a[i]]===undefined) seen[a[i]]=0; seen[a[i]]++; }
    for(var j=0;j<b.length;j++){ if(seen[b[j]]>0){ hit++; seen[b[j]]--; } }
    return hit/Math.max(a.length,b.length);
  }
  function score(q,it){
    var nq=normalize(q), s=0;
    (it.question_variants||[]).forEach(function(v){
      var nv=normalize(v);
      if(nq===nv) s+=100;
      else if(nq && (nv.indexOf(nq)>=0 || nq.indexOf(nv)>=0)) s+=50;
      else { var ov=charOverlap(nq,nv); if(nq.length>=4 && ov>=0.62) s+=Math.round(ov*45); }
    });
    (it.keywords||[]).forEach(function(k){ if(nq.indexOf(normalize(k))>=0) s+=12; });
    var nt=normalize(it.topic);
    if(nt && nq.indexOf(nt)>=0) s+=18;
    if(nt.length>=2){ var hit=0; for(var i=0;i<nt.length;i++){ if(nq.indexOf(nt[i])>=0) hit++; } s+=Math.round(hit/nt.length*8); }
    var ns=normalize(it.answer.summary).slice(0,40);
    if(nq.length>=3){ var h2=0; for(var j=0;j<nq.length;j+=2){ if(ns.indexOf(nq[j])>=0) h2++; } s+=h2; }
    return s;
  }
  var FOLLOW_PAT=/^(那|那么|它|他|这个|这个呢|周末呢|晚上呢|怎么|多久|几点|怎么办|呢|还有呢)/;
  function resolveQuery(raw){
    var q=raw.trim();
    var follow=FOLLOW_PAT.test(q) && q.length<=12;
    var base=q;
    if(follow && state.context.lastCategory){
      var extra=q.replace(/^(那|那么|它|他|这个|还有|呢|的)/g,'').trim();
      base=state.context.lastTopic + (extra? ' '+extra : '');
    }
    return {q:q,base:base,follow:follow};
  }
  function findAnswer(raw){
    var r=resolveQuery(raw), best=null, bestScore=0;
    ITEMS.forEach(function(it){
      var sc=score(r.base,it);
      if(r.follow && it.category===state.context.lastCategory) sc+=10;
      if(sc>bestScore){ bestScore=sc; best=it; }
    });
    return {item:best,score:bestScore,raw:r};
  }
  function answer(raw){
    var res=findAnswer(raw), it=res.item, sc=res.score;
    if(it && sc>=22){
      state.context={lastItem:it.id,lastCategory:it.category,lastTopic:it.topic,turns:state.context.turns+1};
      appendLocalAnswer(it,res.raw.follow);
      appendFollowUps(it);
    }else{
      appendDontKnow(raw);
    }
    scrollChat();
  }

  function appendUser(text){
    var d=document.createElement('div'); d.className='msg user';
    d.innerHTML='<div class="avatar">我</div><div class="bubble">'+esc(text)+'</div>';
    $('chatLog').appendChild(d); scrollChat();
  }

  function appendLocalAnswer(it,isFollow){
    var d=document.createElement('div'); d.className='msg bot local';
    var h='<div class="avatar">'+icon('book')+'</div><div class="bubble">';
    if(isFollow) h+='<div class="ans-lead">'+icon('chat')+'接着「'+esc(it.topic)+'」：</div>';
    h+=answerBody(it);
    h+='<div class="status-line"><span class="st st-verified">本地检索 · 官网资料</span>'+statusTags(it)+'</div>';
    h+=sourceBlock(it);
    h+='<div class="ans-actions">'
      +'<button class="mini-btn act-detail" data-id="'+esc(it.id)+'">'+icon('chevron')+'详情</button>'
      +'<button class="mini-btn act-help'+(state.helpful[it.id]===1?' on':'')+'" data-val="1" data-id="'+esc(it.id)+'">'+icon('thumbUp')+'有用</button>'
      +'<button class="mini-btn act-help'+(state.helpful[it.id]===-1?' on':'')+'" data-val="-1" data-id="'+esc(it.id)+'">'+icon('thumbDown')+'不准</button>'
      +'<button class="mini-btn act-correct" data-id="'+esc(it.id)+'">'+icon('edit')+'纠错</button></div>';
    h+='<div class="correct-form"><div style="font-size:11.5px;color:var(--muted);margin-bottom:6px">你认为正确答案是什么？（仅存本机，提交后待核实）</div>'
      +'<textarea placeholder="请输入你认为正确的信息…"></textarea>'
      +'<div class="row"><button class="mini-btn cf-cancel">取消</button><button class="btn-primary cf-submit" data-id="'+esc(it.id)+'">提交纠错</button></div></div>';
    h+='</div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d); scrollChat(); persistCurrent();
  }

  /* 消息区统一事件委托：恢复的消息 DOM 也能正常交互 */
  function bindChatDelegates(){
    $('chatLog').addEventListener('click',function(e){
      var b=e.target.closest('button, .ai-ref, .follow-chip');
      if(!b || !$('chatLog').contains(b)) return;
      if(b.classList.contains('act-detail')||b.classList.contains('ai-ref')){
        openDetail(b.getAttribute('data-id')); return;
      }
      if(b.classList.contains('act-help')){
        var id=b.getAttribute('data-id'), v=parseInt(b.getAttribute('data-val'),10);
        var box=b.closest('.bubble');
        state.helpful[id]=v; save('hebau_helpful',state.helpful);
        toast(v===1?'感谢反馈':'已记录，感谢反馈');
        Array.prototype.forEach.call(box.querySelectorAll('.act-help'),function(x){x.classList.remove('on');});
        b.classList.add('on'); persistCurrent(); return;
      }
      if(b.classList.contains('act-correct')){
        var cf=b.closest('.bubble').querySelector('.correct-form');
        if(cf) cf.classList.toggle('show'); return;
      }
      if(b.classList.contains('cf-cancel')){ b.closest('.correct-form').classList.remove('show'); return; }
      if(b.classList.contains('cf-submit')){
        var form=b.closest('.correct-form'), v2=form.querySelector('textarea').value.trim();
        if(!v2){ toast('请填写纠错内容'); return; }
        state.corrections[b.getAttribute('data-id')]=v2;
        save('hebau_corrections',state.corrections);
        form.classList.remove('show'); toast('纠错已提交，待管理员核实');
        appendBotNote('已记录你的纠错，答案上方会显示「用户纠错」标记。正式修正需管理员核实后更新知识库。');
        return;
      }
      if(b.classList.contains('ai-help')){ b.classList.add('on'); toast('感谢反馈'); persistCurrent(); return; }
      if(b.classList.contains('ai-feedback')){
        openFeedback(); $('fbText').value='AI 回答反馈（问题：'+(b.getAttribute('data-q')||'')+'）\n'; return;
      }
      if(b.classList.contains('follow-chip')){ send(b.getAttribute('data-q')); return; }
    });
  }

  function appendFollowUps(it){
    var sib=ITEMS.filter(function(x){return x.category===it.category && x.id!==it.id;}).slice(0,3);
    if(!sib.length) return;
    var d=document.createElement('div'); d.className='msg bot local';
    var h='<div class="avatar" style="background:#edf1ee;color:#5c6e63">'+icon('chat')+'</div><div class="bubble follow">'
      +'<div class="follow-row"><div class="fl">你还可以接着问：</div>';
    sib.forEach(function(s){ h+='<span class="follow-chip" data-q="'+esc(s.topic)+'">'+esc(s.topic)+'</span>'; });
    h+='</div></div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d); scrollChat(); persistCurrent();
  }

  function appendDontKnow(raw){
    var d=document.createElement('div'); d.className='msg bot local';
    var h='<div class="avatar">'+icon('info')+'</div><div class="bubble">'
      +'<div class="ans-summary">这个问题我暂时答不上来</div>'
      +'<div style="font-size:12.5px;color:var(--muted);margin-top:6px">本助手只收录河北农业大学官网可公开查证的校园服务与学习生活信息。你问的「'+esc(raw)+'」没有匹配到可核实条目，因此我无法给出可靠答案——不猜、不编。</div>'
      +'<div class="status-line"><span class="st st-unclear">超出范围 / 官网未明确</span></div>'
      +'<div class="src-box"><div>建议：</div>'
      +'<div>① 查学校官网 <a href="http://www.hebau.edu.cn/" target="_blank" rel="noopener">www.hebau.edu.cn</a> 或官方微信公众号；</div>'
      +'<div>② 到知识库标签页按分类浏览核实；</div>'
      +'<div>③ 在设置里的「意见反馈」告诉我，纳入后续更新。</div></div></div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d); scrollChat(); persistCurrent();
  }

  function appendBotNote(text){
    var d=document.createElement('div'); d.className='msg bot local';
    d.innerHTML='<div class="avatar">'+icon('info')+'</div><div class="bubble" style="font-size:12.5px;color:#4b5b52">'+esc(text)+'</div>';
    $('chatLog').appendChild(d); scrollChat(); persistCurrent();
  }

  /* ---------- AI 问答 ---------- */
  function mdToHtml(t){
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|\n)\s*[-•]\s+/g,'$1• ')
      .replace(/\n/g,'<br>');
  }
  function appendAIBubble(question){
    var d=document.createElement('div'); d.className='msg bot ai-answer';
    var h='<div class="avatar">'+icon('sparkle')+'</div><div class="bubble">'
      +'<div class="status-line" style="margin-top:0;margin-bottom:8px"><span class="st st-ai">'+icon('sparkle')+'AI 回答 · 依据官网资料</span></div>'
      +'<div class="ai-content"><span class="typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>正在思考</span></div>'
      +'<div class="ai-refs hidden"><div class="rf-title">'+icon('link')+'参考来源（点击查看详情）</div><div class="rf-list"></div></div>'
      +'<div class="ans-actions hidden">'
      +'<button class="mini-btn ai-help" data-val="1">'+icon('thumbUp')+'有用</button>'
      +'<button class="mini-btn ai-help" data-val="-1">'+icon('thumbDown')+'不准确</button>'
      +'<button class="mini-btn ai-feedback" data-q="'+esc(question||'')+'">'+icon('edit')+'反馈</button></div>'
      +'</div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d); scrollChat();
    var contentEl=d.querySelector('.ai-content'), first=true;
    return {
      el:d,
      token:function(t){ if(first){ contentEl.innerHTML=''; first=false; } contentEl.innerHTML=mdToHtml(t); scrollChat(); },
      finish:function(res,question){
        if(!res.text) contentEl.innerHTML='<span style="color:var(--danger)">（AI 未返回内容）</span>';
        if(res.refs && res.refs.length){
          var refsBox=d.querySelector('.ai-refs'); refsBox.classList.remove('hidden');
          var list=d.querySelector('.rf-list'), html='';
          res.refs.forEach(function(it){
            html+='<span class="ai-ref" data-id="'+esc(it.id)+'">'+esc(it.topic)+' · '+esc(it.id)+'</span>';
          });
          list.innerHTML=html;
        }
        state.aiHistory.push({role:'user',content:question});
        state.aiHistory.push({role:'assistant',content:res.text||''});
        if(state.aiHistory.length>16) state.aiHistory=state.aiHistory.slice(-16);
        d.querySelector('.ans-actions').classList.remove('hidden');
        scrollChat(); persistCurrent();
      },
      fail:function(res,question){
        var msg= res.reason==='disabled' ? 'AI 模式未启用'
          : res.reason==='incomplete' ? 'AI 配置不完整'
          : res.reason==='timeout' ? 'AI 请求超时'
          : 'AI 请求失败：'+(res.error||'未知错误');
        contentEl.innerHTML='<div class="ai-error">'+esc(msg)+'<br>已自动切换到本地检索模式回答。</div>';
        appendBotNote('以下为【本地检索】答案（未经过 AI）：');
        answer(question);
        if(window.HebauAI) window.HebauAI.updateBadge();
        persistCurrent();
      }
    };
  }
  function sendAI(text){
    var bubble=appendAIBubble(text);
    window.HebauAI.ask(text,state.aiHistory,bubble.token,function(res){
      if(res.ok) bubble.finish(res,text); else bubble.fail(res,text);
    });
  }

  function autoGrow(){
    var el=$('qInput'); el.style.height='auto';
    var h=el.scrollHeight;
    el.style.height=Math.min(h,120)+'px';
    el.style.overflowY=h>120?'auto':'hidden';
  }
  function send(text){
    text=(text||'').trim(); if(!text) return;
    if(state.tab!=='chat') switchTab('chat');
    $('welcome').style.display='none';
    appendUser(text);
    var s=currentSession();
    if(s.title==='新对话') s.title=text.slice(0,14)+(text.length>14?'…':'');
    persistCurrent();
    $('qInput').value=''; autoGrow();
    var btn=$('btnSend'); btn.disabled=true;
    setTimeout(function(){
      try{
        if(window.HebauAI && window.HebauAI.isOn()) sendAI(text);
        else answer(text);
      }finally{ btn.disabled=false; }
    },120);
  }

  /* ---------- 反馈 ---------- */
  function openFeedback(){ $('feedbackModal').classList.remove('hidden'); }
  function closeFeedback(){ $('feedbackModal').classList.add('hidden'); }
  function submitFeedback(){
    var rec={time:new Date().toISOString(),type:$('fbType').value,text:$('fbText').value.trim()};
    if(!rec.text){ $('fbMsg').textContent='请填写反馈内容'; return; }
    state.feedback.push(rec); save('hebau_feedback',state.feedback);
    $('fbText').value='';
    $('fbMsg').textContent='已提交，感谢你的反馈（共 '+state.feedback.length+' 条，保存在本机）';
    toast('反馈已保存');
  }
  function exportFeedback(){
    var data={meta:KB.meta,feedback:state.feedback,corrections:state.corrections};
    var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='campus-qa-feedback-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); },1000);
    toast('反馈已导出');
  }

  /* ---------- 会话抽屉 ---------- */
  function renderChatList(){
    var h='';
    sessions.list.forEach(function(s){
      var count=((s.html||'').match(/class="msg /g)||[]).length;
      h+='<div class="chat-row'+(s.id===sessions.currentId?' active':'')+'" data-id="'+esc(s.id)+'">'
        +'<div class="chat-row-main"><span class="chat-row-title">'+esc(s.title||'新对话')+'</span>'
        +'<span class="chat-row-meta">'+timeAgo(s.updated)+' · '+count+' 条消息</span></div>'
        +'<button class="chat-del" data-del="'+esc(s.id)+'" aria-label="删除对话">'+icon('trash')+'</button></div>';
    });
    $('chatList').innerHTML=h||'<div class="empty-list">暂无对话</div>';
    $('chatsFoot').textContent='共 '+sessions.list.length+' 个对话 · 仅保存在本机浏览器';
  }
  function closeChats(){ $('chatsMask').classList.add('hidden'); }
  function openChats(){ renderChatList(); $('chatsMask').classList.remove('hidden'); }
  function restoreCurrent(){
    var s=currentSession();
    $('chatLog').innerHTML=s.html||'';
    state.aiHistory=(s.aiHistory||[]).slice();
    state.context={lastItem:null,lastCategory:null,lastTopic:null,turns:0};
    if(s.context){
      state.context.lastItem=s.context.lastItem||null;
      state.context.lastCategory=s.context.lastCategory||null;
      state.context.lastTopic=s.context.lastTopic||null;
      state.context.turns=s.context.turns||0;
    }
    $('welcome').style.display=s.hasChat?'none':'';
    renderChatList(); scrollChat();
  }
  function loadSession(sid,skipPersist){
    if(!skipPersist && sid!==sessions.currentId) persistCurrent();
    var s=sessions.list.filter(function(x){return x.id===sid;})[0];
    if(!s) return;
    sessions.currentId=sid; saveSessions();
    restoreCurrent(); switchTab('chat'); closeChats();
  }
  function newChat(){
    persistCurrent();
    var s=newSessionObj();
    sessions.list.unshift(s); sessions.currentId=s.id; saveSessions();
    $('chatLog').innerHTML=''; $('welcome').style.display='';
    state.aiHistory=[]; state.context={lastItem:null,lastCategory:null,lastTopic:null,turns:0};
    switchTab('chat'); closeChats(); renderChatList(); scrollChat();
    toast('已新建对话');
  }
  function deleteChat(id){
    if(sessions.list.length<=1){ toast('至少保留一个对话'); return; }
    if(!window.confirm('删除这个对话？')) return;
    sessions.list=sessions.list.filter(function(s){return s.id!==id;});
    if(sessions.currentId===id){
      sessions.currentId=sessions.list[0].id;
      saveSessions(); loadSession(sessions.currentId,true);
    }else{ saveSessions(); renderChatList(); }
    toast('对话已删除');
  }

  /* ---------- 初始化 ---------- */
  function init(){
    paintIcons();

    $('kbCount').textContent=ITEMS.length+' 条';
    $('kbFoot').innerHTML='知识库 v'+esc(KB.meta.version)+' · '+ITEMS.length+' 条 · 快照 '+esc(KB.meta.build_date)
      +'<br>所有条目来自学校官网，作为 AI 回答的事实依据';
    renderCatChips(); renderItems();

    var quick=['图书馆几点关门？','作弊处分是什么？','宿舍几点关门','怎么交学费','校园卡怎么充值','国家奖学金多少钱'];
    var cr=$('quickChips');
    quick.forEach(function(q){
      var c=document.createElement('span'); c.className='chip'; c.textContent=q;
      c.onclick=function(){send(q);}; cr.appendChild(c);
    });

    $('btnSend').onclick=function(){ send($('qInput').value); };
    $('qInput').addEventListener('input',autoGrow);
    $('qInput').addEventListener('keydown',function(e){
      if(e.key==='Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); send($('qInput').value); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'),function(b){
      b.onclick=function(){ switchTab(b.getAttribute('data-tab')); };
    });
    $('kbSearch').addEventListener('input',function(){ state.search=this.value; renderItems(); });

    $('btnNewChat').onclick=newChat;
    $('drawerNewChat').onclick=newChat;
    $('btnChats').onclick=openChats;
    $('closeChats').onclick=closeChats;
    $('chatsMask').addEventListener('click',function(e){ if(e.target===$('chatsMask')) closeChats(); });
    $('chatList').onclick=function(e){
      var del=e.target.closest('.chat-del');
      if(del){ deleteChat(del.getAttribute('data-del')); return; }
      var row=e.target.closest('.chat-row');
      if(row) loadSession(row.getAttribute('data-id'));
    };
    bindChatDelegates();
    restoreCurrent();

    $('btnSettings').onclick=function(){ window.HebauAI.openSettings(); };
    $('btnFeedback').onclick=function(){ $('settingsModal').classList.add('hidden'); openFeedback(); };
    $('closeFeedback').onclick=closeFeedback;
    $('fbSubmit').onclick=submitFeedback;
    $('fbExport').onclick=exportFeedback;
    $('feedbackModal').addEventListener('click',function(e){ if(e.target===$('feedbackModal')) closeFeedback(); });

    if(window.HebauAI) window.HebauAI.init();
    autoGrow();
  }
  init();

  window.HebauApp={toast:toast,goChat:goChat,switchTab:switchTab};
})();
