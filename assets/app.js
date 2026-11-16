/* 河北农业大学校园问答助手 —— 静态演示交互逻辑
 * 特性：本地离线匹配问答 / 上下文追问 / 用户纠错(存localStorage) /
 *       超范围"不知道"引导 / 试用反馈 / 来源与更新时间展示
 */
(function(){
  'use strict';
  var KB = window.KB_DATA;
  if(!KB){ document.body.innerHTML='<p style="padding:40px">知识库数据未加载，请确认 data/knowledge-base.js 存在。</p>'; return; }

  var ITEMS = KB.items;
  var CATS  = KB.taxonomy;
  var byId  = {};
  ITEMS.forEach(function(it){ byId[it.id]=it; });

  // ---------- 状态 ----------
  var state = {
    view:'chat',
    currentCat:null,
    context:{ lastItem:null, lastCategory:null, lastTopic:null, turns:0 },
    aiHistory:[],                                  // [{role,content}] 多轮上下文
    corrections: load('hebau_corrections', {}),   // {itemId: correctedText}
    helpful: load('hebau_helpful', {}),           // {itemId: 1|-1}
    feedback: load('hebau_feedback', [])
  };

  function load(k,d){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }
  function save(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }

  function toast(msg){
    var t=$('toast'); t.textContent=msg; t.classList.add('show');
    clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove('show');},2200);
  }

  // ---------- 图标 ----------
  var ICONS={library:'📚',dormitory:'🏠',dining:'🍚',campus_card:'💳',academic:'🎓',payment:'💰',aid:'🏅',
    discipline:'⚖️',status:'📋',services:'📮',health:'🩺',transport:'🚌',sports:'🏀',express:'📦',phones:'☎️',conduct:'⭐'};

  // ---------- 侧边栏分类 ----------
  function renderCats(filter){
    filter=(filter||'').trim();
    var box=$('catList'); box.innerHTML='';
    CATS.forEach(function(c){
      if(filter && c.name.indexOf(filter)<0 && c.id.indexOf(filter)<0) return;
      var n=ITEMS.filter(function(i){return i.category===c.name;}).length;
      var el=document.createElement('div');
      el.className='cat-item'+(state.currentCat===c.id?' active':'');
      el.innerHTML='<span class="ico">'+(ICONS[c.id]||'•')+'</span><span>'+esc(c.name)+'</span><span class="num">'+n+'</span>';
      el.onclick=function(){ openCategory(c.id); };
      box.appendChild(el);
    });
    if(!box.children.length) box.innerHTML='<div style="padding:16px;color:#6b7a70;font-size:13px">无匹配分类</div>';
  }

  function openCategory(cid){
    state.currentCat=cid;
    var c=CATS.filter(function(x){return x.id===cid;})[0];
    $('topTitle').textContent=c?c.name:'智能问答';
    renderCats();
    renderBrowse(cid);
    switchView('browse');
    if(window.innerWidth<=720) $('sidebar').classList.add('collapsed');
  }

  function switchView(v){
    state.view=v;
    $('chatView').classList.toggle('hidden',v!=='chat');
    $('browseView').classList.toggle('hidden',v!=='browse');
    $('detailView').classList.toggle('hidden',v!=='detail');
    if(v!=='chat') $('topTitle').textContent = (v==='browse' && state.currentCat)
      ? (CATS.filter(function(c){return c.id===state.currentCat;})[0]||{}).name
      : (v==='detail'?'条目详情':'智能问答');
  }

  function goChat(){
    state.currentCat=null; switchView('chat'); $('topTitle').textContent='智能问答'; renderCats();
  }

  // ---------- 分类浏览 ----------
  function renderBrowse(cid){
    var c=CATS.filter(function(x){return x.id===cid;})[0];
    var list=ITEMS.filter(function(i){return i.category===c.name;});
    var h='<div class="browse-head"><h2>'+(ICONS[cid]||'')+' '+esc(c.name)+'</h2><p>'+esc(c.desc)+' · 共 '+list.length+' 条</p></div>';
    h+='<div class="item-grid">';
    list.forEach(function(it){
      h+='<div class="item-card" data-id="'+it.id+'">'
        +'<div class="it-topic">'+esc(it.topic)+'</div>'
        +'<div class="it-sum">'+esc(it.answer.summary)+'</div>'
        +'<div class="it-tags">'+statusTags(it,true)+'</div></div>';
    });
    h+='</div>';
    $('browseWrap').innerHTML=h;
    Array.prototype.forEach.call($('browseWrap').querySelectorAll('.item-card'),function(el){
      el.onclick=function(){ openDetail(el.getAttribute('data-id')); };
    });
  }

  function browseAll(){
    var h='<div class="browse-head"><h2>📖 全部知识条目</h2><p>共 '+ITEMS.length+' 条，按分类整理，点击查看详情与来源。</p></div>';
    CATS.forEach(function(c){
      var list=ITEMS.filter(function(i){return i.category===c.name;});
      if(!list.length) return;
      h+='<div class="cat-block"><h3>'+(ICONS[c.id]||'')+' '+esc(c.name)+'<span class="cnt">'+list.length+' 条</span></h3><div class="item-grid">';
      list.forEach(function(it){
        h+='<div class="item-card" data-id="'+it.id+'"><div class="it-topic">'+esc(it.topic)+'</div>'
          +'<div class="it-sum">'+esc(it.answer.summary)+'</div>'
          +'<div class="it-tags">'+statusTags(it,true)+'</div></div>';
      });
      h+='</div></div>';
    });
    $('browseWrap').innerHTML=h;
    Array.prototype.forEach.call($('browseWrap').querySelectorAll('.item-card'),function(el){
      el.onclick=function(){ openDetail(el.getAttribute('data-id')); };
    });
    switchView('browse'); $('topTitle').textContent='全部条目';
  }

  function statusTags(it,compact){
    var m={verified:['官网已核实',''],historical:['较早/某年安排','hist'],
      'official-unclear':['官网未明确','unclear'],'other-audience':['特定群体适用','other']};
    var t=m[it.status]||m.verified;
    return '<span class="tag '+t[1]+'">'+t[0]+'</span>'
      +'<span class="tag">核对 '+esc(it.maintenance.last_reviewed)+'</span>';
  }

  // ---------- 详情 ----------
  function openDetail(id){
    var it=byId[id]; if(!it) return;
    var h='<button class="detail-back" id="detailBack">← 返回</button><div class="detail-card">'
      +'<h2>'+esc(it.topic)+'</h2>'
      +'<div class="detail-path">'+esc(it.category)+' / '+esc(it.topic)+' · 条目 '+esc(it.id)+'</div>'
      +answerBody(it)
      +sourceBlock(it)
      +maintBlock(it)
      +'</div>';
    $('detailWrap').innerHTML=h;
    $('detailBack').onclick=function(){ backFromDetail(); };
    switchView('detail'); $('topTitle').textContent='条目详情';
  }

  function backFromDetail(){
    if(state.currentCat) renderBrowse(state.currentCat), switchView('browse');
    else browseAll();
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
    if(corrected) h+='<div class="correct-note">✎ 用户纠错（仅存本机，待管理员核实）：'+esc(corrected)+'</div>';
    return h;
  }

  function sourceBlock(it){
    var s=it.source;
    var h='<div class="src-box"><div>📎 来源：<a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(s.title)+'</a></div>'
      +'<div class="src-meta">页面更新：'+esc(s.published)+'　·　官网核对：'+esc(s.accessed)
      +'　·　适用：'+esc(it.audience.join('、'))+'</div>';
    if(it.extra_sources && it.extra_sources.length){
      h+='<div class="src-meta">补充来源：';
      it.extra_sources.forEach(function(x,k){
        if(k) h+='；';
        h+='<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.title)+'</a>';
      });
      h+='</div>';
    }
    if(it.notes) h+='<div class="src-meta">说明：'+esc(it.notes)+'</div>';
    h+='</div>';
    return h;
  }

  function maintBlock(it){
    var m=it.maintenance;
    return '<div class="maint-box"><h4>维护信息</h4>'
      +'<div class="maint-row"><span>最后核对</span><span>'+esc(m.last_reviewed)+'</span></div>'
      +'<div class="maint-row"><span>复核周期</span><span>'+esc(m.review_cycle)+'</span></div>'
      +'<div class="maint-row"><span>纠错提交数</span><span>'+esc(m.feedback_count)+'</span></div>'
      +'<div class="maint-row"><span>启用状态</span><span>'+(m.enabled?'启用':'停用')+'</span></div></div>';
  }

  // ---------- 问答匹配 ----------
  function normalize(s){ return String(s||'').toLowerCase().replace(/[\s，。？?！!、,.;：:]/g,''); }

  // 字符级重合度（用于容错：变体差一两个字也能命中）
  function charOverlap(a,b){
    if(!a||!b) return 0;
    var seen={},hit=0;
    for(var i=0;i<a.length;i++){ if(seen[a[i]]===undefined) seen[a[i]]=0; seen[a[i]]++; }
    for(var j=0;j<b.length;j++){ if(seen[b[j]]>0){ hit++; seen[b[j]]--; } }
    return hit/Math.max(a.length,b.length);
  }

  // 计算单条匹配分
  function score(q,it){
    var nq=normalize(q), s=0;
    (it.question_variants||[]).forEach(function(v){
      var nv=normalize(v);
      if(nq===nv) s+=100;
      else if(nq && (nv.indexOf(nq)>=0 || nq.indexOf(nv)>=0)) s+=50;
      else {
        var ov=charOverlap(nq,nv);
        if(nq.length>=4 && ov>=0.62) s+=Math.round(ov*45);   // 容错：如"几点关门" vs "几点开门"
      }
    });
    // 关键词命中
    (it.keywords||[]).forEach(function(k){ if(nq.indexOf(normalize(k))>=0) s+=12; });
    var nt=normalize(it.topic);
    if(nt && nq.indexOf(nt)>=0) s+=18;
    // topic 与 query 逐字重合
    if(nt.length>=2){ var hit=0; for(var i=0;i<nt.length;i++){ if(nq.indexOf(nt[i])>=0) hit++; } s+=Math.round(hit/nt.length*8); }
    // 正文前若干字命中
    var ns=normalize(it.answer.summary).slice(0,40);
    if(nq.length>=3){ var h2=0; for(var j=0;j<nq.length;j+=2){ if(ns.indexOf(nq[j])>=0) h2++; } s+=h2; }
    return s;
  }

  // 追问解析：把"那周末呢""它几点关门"结合上下文
  var FOLLOW_PAT=/^(那|那么|它|他|这个|这个呢|液体|周末呢|晚上呢|怎么|多久|几点|怎么办|呢|还有呢)/;
  function resolveQuery(raw){
    var q=raw.trim();
    var follow=FOLLOW_PAT.test(q) && q.length<=12;
    var base=q;
    if(follow && state.context.lastCategory){
      // 提取主题补充词
      var extra=q.replace(/^(那|那么|它|他|这个|还有|呢|的)/g,'').trim();
      base=state.context.lastTopic + (extra? ' '+extra : '');
    }
    return {q:q, base:base, follow:follow};
  }

  function findAnswer(raw){
    var r=resolveQuery(raw);
    var best=null,bestScore=0;
    ITEMS.forEach(function(it){
      var sc=score(r.base,it);
      // 上下文：同分类加权
      if(r.follow && it.category===state.context.lastCategory) sc+=10;
      if(sc>bestScore){ bestScore=sc; best=it; }
    });
    return {item:best, score:bestScore, raw:r};
  }

  function answer(raw){
    var res=findAnswer(raw);
    var it=res.item, sc=res.score;
    var THRESHOLD=22;
    if(it && sc>=THRESHOLD){
      // 更新上下文
      state.context={lastItem:it.id,lastCategory:it.category,lastTopic:it.topic,turns:state.context.turns+1};
      appendBotAnswer(it,res.raw.follow);
      // 相关追问
      appendFollowUps(it);
    }else{
      appendDontKnow(raw,it);
    }
    $('chatLog').scrollTop=$('chatLog').scrollHeight;
  }

  function appendUser(text){
    var d=document.createElement('div'); d.className='msg user';
    d.innerHTML='<div class="avatar">我</div><div class="bubble">'+esc(text)+'</div>';
    $('chatLog').appendChild(d);
  }

  function appendBotAnswer(it,isFollow){
    var d=document.createElement('div'); d.className='msg bot';
    var h='<div class="avatar">🌾</div><div class="bubble">';
    if(isFollow) h+='<div style="font-size:11px;color:#6b7a70;margin-bottom:6px">接着「'+esc(it.topic)+'」：</div>';
    h+=answerBody(it);
    h+='<div class="status-line">'+statusTags(it,false)+'</div>';
    h+=sourceBlock(it);
    // 纠错/反馈按钮
    h+='<div class="ans-actions">'
      +'<button class="mini-btn act-detail" data-id="'+it.id+'">查看详情</button>'
      +'<button class="mini-btn act-help" data-val="1" data-id="'+it.id+'">👍 有用'+(state.helpful[it.id]===1?' ✓':'')+'</button>'
      +'<button class="mini-btn act-help" data-val="-1" data-id="'+it.id+'">👎 不准确'+(state.helpful[it.id]===-1?' ✓':'')+'</button>'
      +'<button class="mini-btn act-correct" data-id="'+it.id+'">✎ 纠错</button></div>';
    h+='<div class="correct-form" id="cf-'+it.id+'"><div style="font-size:12px;color:#6b7a70;margin-bottom:6px">'
      +'你认为正确答案是什么？（保存在本机，提交后标记为待核实）</div>'
      +'<textarea placeholder="请输入你认为正确的信息…"></textarea>'
      +'<div class="row"><button class="mini-btn cf-cancel">取消</button><button class="btn-primary cf-submit" data-id="'+it.id+'">提交纠错</button></div></div>';
    h+='</div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d);
    wireAnswerActions(d,it);
  }

  function wireAnswerActions(root,it){
    Array.prototype.forEach.call(root.querySelectorAll('.act-detail'),function(b){
      b.onclick=function(){ openDetail(b.getAttribute('data-id')); };
    });
    Array.prototype.forEach.call(root.querySelectorAll('.act-help'),function(b){
      b.onclick=function(){
        var v=parseInt(b.getAttribute('data-val'),10);
        state.helpful[it.id]=v; save('hebau_helpful',state.helpful);
        toast(v===1?'感谢反馈！':'已记录，感谢反馈！');
        Array.prototype.forEach.call(root.querySelectorAll('.act-help'),function(x){x.classList.remove('on');});
        b.classList.add('on');
      };
    });
    var form=root.querySelector('.correct-form');
    Array.prototype.forEach.call(root.querySelectorAll('.act-correct'),function(b){
      b.onclick=function(){ form.classList.toggle('show'); };
    });
    var cancel=root.querySelector('.cf-cancel'); if(cancel) cancel.onclick=function(){form.classList.remove('show');};
    var submit=root.querySelector('.cf-submit');
    if(submit) submit.onclick=function(){
      var ta=form.querySelector('textarea'), v=ta.value.trim();
      if(!v){ toast('请填写纠错内容'); return; }
      state.corrections[it.id]=v; save('hebau_corrections',state.corrections);
      it.maintenance.feedback_count++; save('hebau_corrections',state.corrections);
      form.classList.remove('show');
      toast('纠错已提交（存本机，待管理员核实）');
      appendBotNote('已记录你对「'+it.topic+'」的纠错，答案上方会显示「用户纠错」标记。正式修正需管理员核实后更新知识库。');
    };
  }

  function appendFollowUps(it){
    // 找同分类的其他条目作为追问建议
    var sib=ITEMS.filter(function(x){return x.category===it.category && x.id!==it.id;}).slice(0,3);
    if(!sib.length) return;
    var d=document.createElement('div'); d.className='msg bot';
    var h='<div class="avatar" style="background:#eef2ed;color:#6b7a70">💡</div><div class="bubble" style="background:#fafbf9">'
      +'<div class="follow-row"><div class="fl">你还可以接着问：</div>';
    sib.forEach(function(s){
      h+='<span class="follow-chip" data-q="'+esc(s.topic)+'">'+esc(s.topic)+'</span>';
    });
    h+='</div></div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d);
    Array.prototype.forEach.call(d.querySelectorAll('.follow-chip'),function(c){
      c.onclick=function(){ send(c.getAttribute('data-q')); };
    });
  }

  function appendDontKnow(raw,near){
    var cls = near ? '' : 'dontknow';
    var d=document.createElement('div'); d.className='msg bot';
    var h='<div class="avatar">🌾</div><div class="bubble '+cls+'">'
      +'<div class="ans-summary">这个问题我暂时答不上来</div>'
      +'<div class="why">本助手只收录河北农业大学官网（hebau.edu.cn）可公开查证的校园服务与学习生活信息。你问的「'+esc(raw)+'」目前没有匹配到可核实的条目，因此我无法给出可靠答案——不猜、不编。</div>'
      +'<div class="status-line"><span class="st st-unclear">超出范围 / 官网未明确</span></div>'
      +'<div class="src-box"><div>建议：</div>'
      +'<div class="src-meta">① 查学校官网 <a href="http://www.hebau.edu.cn/" target="_blank" rel="noopener">www.hebau.edu.cn</a> 或官方微信公众号；</div>'
      +'<div class="src-meta">② 联系相关部门，可先查 <a href="#" class="goto-phones">常用电话</a>；</div>'
      +'<div class="src-meta">③ 用下方「试用反馈」告诉我，我会纳入后续更新。</div></div></div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d);
    var p=d.querySelector('.goto-phones'); if(p) p.onclick=function(e){e.preventDefault();openCategory('phones');};
  }

  function appendBotNote(text){
    var d=document.createElement('div'); d.className='msg bot';
    d.innerHTML='<div class="avatar">🌾</div><div class="bubble" style="font-size:13px;color:#435048">'+esc(text)+'</div>';
    $('chatLog').appendChild(d);
    $('chatLog').scrollTop=$('chatLog').scrollHeight;
  }

  // ---------- AI 主导问答 ----------
  function mdToHtml(t){
    // 轻量 Markdown：加粗、** 、列表、- 、换行
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|\n)\s*[-•]\s+/g,'$1• ')
      .replace(/\n/g,'<br>');
  }

  function appendAIBubble(refs){
    var d=document.createElement('div'); d.className='msg bot ai-answer';
    var h='<div class="avatar">🤖</div><div class="bubble">'
      +'<div class="status-line" style="margin-top:0;margin-bottom:8px"><span class="ai-mode-tag">AI 回答 · 依据官网知识库</span></div>'
      +'<div class="ai-content"><span class="typing">正在思考…</span></div>';
    h+='<div class="ai-refs" style="display:none"><div class="rf-title">📎 参考来源（点击查看详情）</div><div class="rf-list"></div></div>';
    h+='<div class="ans-actions" style="display:none">'
      +'<button class="mini-btn ai-help" data-val="1">👍 有用</button>'
      +'<button class="mini-btn ai-help" data-val="-1">👎 不准确</button>'
      +'<button class="mini-btn ai-feedback">✎ 反馈/纠错</button></div>';
    h+='</div></div>';
    d.innerHTML=h; $('chatLog').appendChild(d);
    var contentEl=d.querySelector('.ai-content');
    var first=true;
    return {
      el:d,
      token:function(t){ if(first){ contentEl.innerHTML=''; first=false; } contentEl.innerHTML=mdToHtml(t);
        $('chatLog').scrollTop=$('chatLog').scrollHeight; },
      finish:function(res,question){
        if(!res.text) contentEl.innerHTML='<span style="color:#b91c1c">（AI 未返回内容）</span>';
        // 参考来源
        if(res.refs&&res.refs.length){
          var refsBox=d.querySelector('.ai-refs'); refsBox.style.display='block';
          var list=d.querySelector('.rf-list'),html='';
          res.refs.forEach(function(it){
            html+='<span class="ai-ref" data-id="'+it.id+'">'+esc(it.topic)+' · '+esc(it.id)+'</span>';
          });
          list.innerHTML=html;
          Array.prototype.forEach.call(list.querySelectorAll('.ai-ref'),function(r){
            r.onclick=function(){ openDetail(r.getAttribute('data-id')); };
          });
        }
        // 记录历史
        state.aiHistory.push({role:'user',content:question});
        state.aiHistory.push({role:'assistant',content:res.text||''});
        if(state.aiHistory.length>16) state.aiHistory=state.aiHistory.slice(-16);
        // 操作按钮
        var acts=d.querySelector('.ans-actions'); acts.style.display='flex';
        Array.prototype.forEach.call(acts.querySelectorAll('.ai-help'),function(b){
          b.onclick=function(){ b.classList.add('on'); toast('感谢反馈！'); };
        });
        acts.querySelector('.ai-feedback').onclick=function(){ openFeedback(); $('fbText').value='AI 回答反馈（问题：'+question+'）\n'; };
        $('chatLog').scrollTop=$('chatLog').scrollHeight;
      },
      fail:function(res,question){
        var msg= res.reason==='disabled' ? 'AI 模式未启用'
          : res.reason==='incomplete' ? 'AI 配置不完整（接口地址/模型未填）'
          : res.reason==='timeout' ? 'AI 请求超时'
          : 'AI 接口请求失败：'+(res.error||'未知错误');
        contentEl.innerHTML='<div class="ai-error">'+esc(msg)+'<br>已自动切换到本地检索模式回答 ↓</div>';
        // 回退本地
        appendBotNote('以下为【本地检索】答案（未经过 AI）：');
        answer(question);
        if(window.HebauAI) window.HebauAI.updateBadge();
      }
    };
  }

  function sendAI(text){
    var bubble=appendAIBubble();
    window.HebauAI.ask(text, state.aiHistory, bubble.token, function(res){
      if(res.ok) bubble.finish(res,text); else bubble.fail(res,text);
    });
  }

  function send(text){
    text=(text||'').trim(); if(!text) return;
    if(state.view!=='chat'){ goChat(); }
    $('chatIntro').style.display='none';
    appendUser(text);
    $('qInput').value='';
    setTimeout(function(){
      if(window.HebauAI && window.HebauAI.isOn()){ sendAI(text); }
      else { answer(text); }
    }, 120);
  }

  // ---------- 反馈 ----------
  function openFeedback(){ $('feedbackModal').classList.remove('hidden'); }
  function closeFeedback(){ $('feedbackModal').classList.add('hidden'); }
  function submitFeedback(){
    var rec={time:new Date().toISOString(),type:$('fbType').value,
      item:$('fbItem').value.trim(),text:$('fbText').value.trim()};
    if(!rec.text){ $('fbMsg').textContent='请填写反馈内容'; return; }
    state.feedback.push(rec); save('hebau_feedback',state.feedback);
    $('fbText').value=''; $('fbItem').value='';
    $('fbMsg').textContent='已提交，感谢你的反馈！（共 '+state.feedback.length+' 条，保存在本机）';
    toast('反馈已保存');
  }
  function exportFeedback(){
    var data={meta:KB.meta,feedback:state.feedback,corrections:state.corrections,helpful:state.helpful};
    var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='hebau-feedback-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
    toast('反馈已导出');
  }

  // ---------- 初始化 ----------
  function init(){
    renderCats();
    $('kbMetaLine').innerHTML='知识库 v'+esc(KB.meta.version)+' · '+ITEMS.length+' 条<br>快照日期 '+esc(KB.meta.build_date);
    // 快捷问题
    var quick=['图书馆几点关门？','作弊处分是什么？','宿舍几点关门','怎么交学费','校园卡怎么充值','国家奖学金多少钱'];
    var cr=$('quickChips');
    quick.forEach(function(q){ var c=document.createElement('span'); c.className='chip'; c.textContent=q;
      c.onclick=function(){send(q);}; cr.appendChild(c); });

    $('btnSend').onclick=function(){ send($('qInput').value); };
    $('qInput').addEventListener('keydown',function(e){ if(e.key==='Enter') send($('qInput').value); });
    $('menuBtn').onclick=function(){ $('sidebar').classList.toggle('collapsed'); };
    $('sideSearch').addEventListener('input',function(){ renderCats($('sideSearch').value); });
    $('btnFeedback').onclick=openFeedback;
    // AI 设置
    $('btnAiSettings').onclick=function(){ window.HebauAI.openSettings(); };
    $('btnAiSettingsSide').onclick=function(){ window.HebauAI.openSettings(); };
    if(window.HebauAI) window.HebauAI.init();
    $('closeFeedback').onclick=closeFeedback;
    $('fbSubmit').onclick=submitFeedback;
    $('fbExport').onclick=exportFeedback;
    $('feedbackModal').addEventListener('click',function(e){ if(e.target===$('feedbackModal')) closeFeedback(); });
    // 顶部标题点击回问答
    document.querySelector('.topbar-title').style.cursor='pointer';
    document.querySelector('.topbar-title').onclick=goChat;
    // 侧栏首项"智能问答"入口：在分类上方插入
    var first=document.createElement('div'); first.className='cat-item';
    first.innerHTML='<span class="ico">💬</span><span>智能问答</span>';
    first.onclick=goChat; $('catList').insertBefore(first,$('catList').firstChild);
    // 全部条目入口
    var all=document.createElement('div'); all.className='cat-item';
    all.innerHTML='<span class="ico">📖</span><span>全部条目</span><span class="num">'+ITEMS.length+'</span>';
    all.onclick=browseAll; $('catList').insertBefore(all,$('catList').children[1]);
  }
  init();

  // 暴露给 ai.js 使用
  window.HebauApp={ toast:toast, goChat:goChat };
})();
