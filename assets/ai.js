/* 校园问答助手 —— AI 引擎
 * 免费 AI 服务已内置：接口 / 模型 / 密钥预置并默认启用，用户无需填写。
 * 密钥做了轻量混淆（Base64 + 字符反转），不做明文落盘；这是混淆而非强加密。
 * 能力：官网知识库检索增强(RAG) / 多轮上下文 / 流式输出 / 失败回退。
 */
(function(){
  'use strict';

  var KB = window.KB_DATA;
  var KEY = 'hebau_ai_config_v2';

  /* 内置密钥：Base64(反转(原文))，仅避免明文直接暴露 */
  var SEALED_KEY = 'dEJSRFBUMmxQNlJ6WFFOOFJEdHp6a0N3ZzdtdlRLTzZMM0NIalY0MnVGZFJJeWhjLWtz';
  function builtinKey(){
    try { return atob(SEALED_KEY).split('').reverse().join(''); } catch(e){ return ''; }
  }

  var DEFAULT = {
    enabled:true,
    baseURL:'https://api.agnes-ai.cn/v1',
    model:'agnes-3.0-flash',
    apiKey:builtinKey(),
    temperature:0.4,
    topK:4,
    stream:true,
    useKB:true,
    timeout:60000
  };

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function load(){
    var c = clone(DEFAULT);
    try{
      var v = localStorage.getItem(KEY);
      if(v){
        var o = JSON.parse(v);
        if(typeof o.enabled==='boolean') c.enabled=o.enabled;
        if(typeof o.useKB==='boolean') c.useKB=o.useKB;
        if(typeof o.stream==='boolean') c.stream=o.stream;
        if(typeof o.temperature==='number') c.temperature=o.temperature;
        if(typeof o.topK==='number') c.topK=o.topK;
      }
    }catch(e){}
    return c;
  }
  function save(c){
    /* 密钥不写入 localStorage，每次运行由内置值提供 */
    try{
      localStorage.setItem(KEY, JSON.stringify({
        enabled:c.enabled, useKB:c.useKB, stream:c.stream,
        temperature:c.temperature, topK:c.topK
      }));
    }catch(e){}
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }

  var cfg = load();

  /* ---------- 知识库检索（RAG-lite） ---------- */
  function normalize(s){ return String(s||'').toLowerCase().replace(/[\s，。？?！!、,.;：:]/g,''); }
  function overlap(a,b){
    if(!a||!b) return 0; var seen={},hit=0,i;
    for(i=0;i<a.length;i++) seen[a[i]]=(seen[a[i]]||0)+1;
    for(i=0;i<b.length;i++){ if(seen[b[i]]>0){hit++;seen[b[i]]--;} }
    return hit/Math.max(a.length,b.length);
  }
  function score(q,it){
    var nq=normalize(q),s=0;
    (it.question_variants||[]).forEach(function(v){
      var nv=normalize(v);
      if(nq===nv) s+=100;
      else if(nq&&(nv.indexOf(nq)>=0||nq.indexOf(nv)>=0)) s+=50;
      else { var ov=overlap(nq,nv); if(nq.length>=4&&ov>=0.62) s+=Math.round(ov*45); }
    });
    (it.keywords||[]).forEach(function(k){ if(nq.indexOf(normalize(k))>=0) s+=12; });
    var nt=normalize(it.topic);
    if(nt&&nq.indexOf(nt)>=0) s+=18;
    if(nt.length>=2){ var hit=0; for(var i=0;i<nt.length;i++) if(nq.indexOf(nt[i])>=0) hit++; s+=Math.round(hit/nt.length*8); }
    var ns=normalize(it.answer.summary).slice(0,40);
    if(nq.length>=3){ var h2=0; for(var j=0;j<nq.length;j+=2) if(ns.indexOf(nq[j])>=0) h2++; s+=h2; }
    return s;
  }
  function retrieve(q, topK){
    topK = topK || cfg.topK || 4;
    if(!KB || !KB.items) return [];
    var scored = KB.items.map(function(it){ return {it:it, s:score(q,it)}; });
    scored.sort(function(a,b){ return b.s-a.s; });
    return scored.filter(function(x){ return x.s>=12; }).slice(0,topK).map(function(x){ return x.it; });
  }

  var STATUS_LABEL = {
    verified:'官网已核实',
    historical:'较早/某年安排（以当年最新通知为准）',
    'official-unclear':'官网未明确',
    'other-audience':'仅特定群体适用（引用须注明对象）'
  };

  function buildContext(refs){
    if(!cfg.useKB || !refs.length) return '（本次未检索到相关知识库条目，请严格按规则 3 回答。）';
    var out='【知识库资料——均摘自河北农业大学官网（hebau.edu.cn），是你回答的唯一事实依据】\n';
    refs.forEach(function(it,i){
      out+='\n['+(i+1)+'] 条目 '+it.id+' ｜ '+it.category+' / '+it.topic+'\n';
      out+='状态：'+(STATUS_LABEL[it.status]||it.status)+'\n';
      out+='内容：'+it.answer.summary+'\n';
      if(it.answer.details&&it.answer.details.length) out+='补充：'+it.answer.details.join('；')+'\n';
      out+='来源：'+it.source.title+' ｜ '+it.source.url+' ｜ 页面更新：'+it.source.published+' ｜ 官网核对：'+it.source.accessed+'\n';
      if(it.notes) out+='说明：'+it.notes+'\n';
    });
    return out;
  }

  function systemPrompt(refs){
    return '你是「河北农业大学校园问答助手」，由 AI 驱动，面向全体在校学生，回答校园学习、生活、办事与校纪校规问题。\n'+
      '【硬性规则】\n'+
      '1. 只能依据下面【知识库资料】回答。资料来自学校官网，是你的唯一事实依据。\n'+
      '2. 用中文回答，先给直接结论，再列必要要点。简洁、口语化、清楚，不写 Markdown 表格，不堆砌标题。\n'+
      '3. 若资料中没有相关信息，或资料标注「官网未明确」，必须明确说「官网未明确 / 我不知道」，并引导查询学校官网 www.hebau.edu.cn 或联系相关部门。绝不编造、绝不用常识补全、绝不猜测数字或时间。\n'+
      '4. 注意资料状态：标注「较早/某年安排」要提示以当年最新通知为准；标注「仅特定群体适用」要说明适用对象；标注「官网未明确」要如实说明。\n'+
      '5. 结合对话上下文理解追问（如「那周末呢」「怎么续借」），不要重复问已经说过的信息。\n'+
      '6. 回答末尾用一句话注明主要参考的条目编号（如「参考：LIB-001」），便于前端展示溯源。\n\n'+
      buildContext(refs);
  }

  /* ---------- 调用 API ---------- */
  function endpoint(){ return String(cfg.baseURL||'').replace(/\/+$/,'')+'/chat/completions'; }

  function ask(question, history, onToken, onDone){
    var refs = cfg.useKB ? retrieve(question, cfg.topK) : [];
    var messages=[{role:'system',content:systemPrompt(refs)}];
    (history||[]).slice(-8).forEach(function(m){ messages.push({role:m.role,content:m.content}); });
    messages.push({role:'user',content:question});

    if(!cfg.enabled){ onDone({ok:false,reason:'disabled',refs:refs}); return; }
    if(!cfg.baseURL || !cfg.model || !cfg.apiKey){ onDone({ok:false,reason:'incomplete',refs:refs}); return; }

    var headers={'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey};
    var body={model:cfg.model,messages:messages,temperature:Number(cfg.temperature)||0.4,stream:!!cfg.stream};
    var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ctrl.abort();}, cfg.timeout||60000) : null;

    fetch(endpoint(),{
      method:'POST', headers:headers, body:JSON.stringify(body), signal:ctrl?ctrl.signal:undefined
    }).then(function(resp){
      if(!resp.ok) return resp.text().then(function(t){
        var msg=t; try{ var j=JSON.parse(t); msg=(j.error&&(j.error.message||j.error))||t; }catch(e){}
        throw new Error('HTTP '+resp.status+'：'+String(msg).slice(0,240));
      });
      if(!cfg.stream || !resp.body || !resp.body.getReader){
        return resp.json().then(function(j){
          var txt=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'';
          onToken(txt); onDone({ok:true,text:txt,refs:refs});
        });
      }
      var reader=resp.body.getReader(), decoder=new TextDecoder(), buf='', full='';
      function pump(){
        return reader.read().then(function(res){
          if(res.done){ if(timer) clearTimeout(timer); onDone({ok:true,text:full,refs:refs}); return; }
          buf+=decoder.decode(res.value,{stream:true});
          var parts=buf.split('\n'); buf=parts.pop();
          parts.forEach(function(line){
            line=line.trim();
            if(!line||line.charAt(0)!=='d') return;
            var data=line.replace(/^data:\s*/,'');
            if(data==='[DONE]') return;
            try{
              var j=JSON.parse(data);
              var d=j.choices&&j.choices[0]&&(j.choices[0].delta||j.choices[0].message);
              var t=d&&d.content;
              if(t){ full+=t; onToken(full); }
            }catch(e){}
          });
          return pump();
        });
      }
      return pump();
    }).catch(function(err){
      if(timer) clearTimeout(timer);
      var reason = err && err.name==='AbortError' ? 'timeout' : 'error';
      onDone({ok:false,reason:reason,error:String(err&&err.message||err),refs:refs});
    });
  }

  function test(cb){
    fetch(endpoint(),{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey},
      body:JSON.stringify({model:cfg.model,messages:[{role:'user',content:'只回复两个字：正常'}],temperature:0,stream:false,max_tokens:16})
    }).then(function(r){ return r.text().then(function(t){ return {ok:r.ok,status:r.status,text:t}; }); })
      .then(function(r){
        if(!r.ok){ var m=r.text; try{var j=JSON.parse(r.text);m=(j.error&&j.error.message)||m;}catch(e){}
          cb({ok:false,msg:'HTTP '+r.status+' '+String(m).slice(0,180)}); }
        else cb({ok:true,msg:'连接成功，模型可用'});
      })
      .catch(function(e){ cb({ok:false,msg:'请求失败：'+(e.message||e)}); });
  }

  /* ---------- 设置面板（仅开关，无密钥输入） ---------- */
  function fillForm(){
    $('aiEnabled').checked=!!cfg.enabled;
    $('aiUseKB').checked=!!cfg.useKB;
    $('aiStream').checked=!!cfg.stream;
    updateBadge();
  }
  function updateBadge(){
    var b=$('aiStatus'), t=$('aiStatusText'); if(!b) return;
    var on = !!(cfg.enabled && cfg.baseURL && cfg.model && cfg.apiKey);
    if(t) t.textContent = on ? 'AI 就绪' : '本地检索';
    b.classList.toggle('off', !on);
  }
  function openSettings(){ fillForm(); $('settingsModal').classList.remove('hidden'); }
  function closeSettings(){ $('settingsModal').classList.add('hidden'); }

  function bindSettings(){
    $('closeSettings').onclick=closeSettings;
    $('settingsModal').addEventListener('click',function(e){ if(e.target===$('settingsModal')) closeSettings(); });
    $('aiSave').onclick=function(){
      cfg.enabled=$('aiEnabled').checked;
      cfg.useKB=$('aiUseKB').checked;
      cfg.stream=$('aiStream').checked;
      save(cfg); fillForm(); closeSettings();
      if(window.HebauApp) window.HebauApp.toast(cfg.enabled?'AI 问答已启用':'已切换为本地检索');
    };
    $('aiTest').onclick=function(){
      $('aiTestMsg').textContent='正在测试内置 AI 服务…';
      test(function(r){ $('aiTestMsg').textContent=(r.ok?'连接成功：':'连接失败：')+r.msg; });
    };
  }

  window.HebauAI={
    isOn:function(){ return !!(cfg.enabled && cfg.baseURL && cfg.model && cfg.apiKey); },
    config:function(){ return cfg; },
    retrieve:retrieve,
    ask:ask,
    openSettings:openSettings,
    updateBadge:updateBadge,
    init:function(){ bindSettings(); fillForm(); }
  };
})();
