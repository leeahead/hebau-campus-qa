/* 河北农业大学校园问答助手 —— AI 接入模块（OpenAI 兼容协议）
 * 职责：配置管理 / 知识库检索增强(RAG-lite) / 流式调用 AI / 设置面板
 * 对外暴露 window.HebauAI
 *
 * 安全说明：
 * - 配置(含 API Key)仅存本机 localStorage，不写入源码、不随静态文件发布。
 * - 公开部署推荐两种模式：
 *   (1) BYOK：每位访问者填自己的 Key（默认，本模块原生支持）；
 *   (2) 代理：把 baseURL 指向你自己的后端/云函数，由服务端保管 Key（本模块也支持，Key 可留空）。
 */
(function(){
  'use strict';

  var KB = window.KB_DATA;
  var KEY = 'hebau_ai_config_v1';

  // ---------- 预设服务商（均为 OpenAI 兼容 /chat/completions） ----------
  var PRESETS = {
    deepseek:{name:'DeepSeek', baseURL:'https://api.deepseek.com/v1', model:'deepseek-chat', note:'国内直连，兼容 OpenAI'},
    qwen:{name:'通义千问', baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus', note:'阿里云兼容模式'},
    glm:{name:'智谱 GLM', baseURL:'https://open.bigmodel.cn/api/paas/v4', model:'glm-4-flash', note:'智谱开放平台'},
    kimi:{name:'Moonshot Kimi', baseURL:'https://api.moonshot.cn/v1', model:'moonshot-v1-8k', note:'月之暗面'},
    openai:{name:'OpenAI', baseURL:'https://api.openai.com/v1', model:'gpt-4o-mini', note:'需可访问境外网络'},
    custom:{name:'自定义 / 代理', baseURL:'', model:'', note:'兼容 OpenAI 协议；可填自己的代理地址隐藏 Key'}
  };

  var DEFAULT = {
    enabled:false, provider:'deepseek', baseURL:PRESETS.deepseek.baseURL,
    model:PRESETS.deepseek.model, apiKey:'', temperature:0.3,
    topK:4, stream:true, useKB:true, timeout:60000
  };

  function load(){ try{ var v=localStorage.getItem(KEY); if(!v) return clone(DEFAULT);
      var o=JSON.parse(v); return merge(clone(DEFAULT),o); }catch(e){ return clone(DEFAULT); } }
  function save(c){ try{ localStorage.setItem(KEY,JSON.stringify(c)); }catch(e){} }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function merge(a,b){ for(var k in b){ if(Object.prototype.hasOwnProperty.call(b,k)) a[k]=b[k]; } return a; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function $(id){ return document.getElementById(id); }

  var cfg = load();

  // ---------- 知识库检索（RAG-lite，复用本地打分逻辑） ----------
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

  var STATUS_LABEL={verified:'官网已核实',historical:'较早/某年安排（以当年最新通知为准）',
    'official-unclear':'官网未明确','other-audience':'仅特定群体适用（引用须注明对象）'};

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
    return '你是「河北农业大学校园问答助手」，面向全体在校学生，回答校园学习、生活、办事与校纪校规问题。\n'+
      '【硬性规则】\n'+
      '1. 只能依据下面【知识库资料】回答。资料来自学校官网，是你的唯一事实依据。\n'+
      '2. 用中文回答，先给直接结论，再列必要要点；简洁清楚，不写 Markdown 表格。\n'+
      '3. 若资料中没有相关信息，或资料标注「官网未明确」，必须明确说「官网未明确 / 我不知道」，并引导查询学校官网 www.hebau.edu.cn 或联系相关部门。绝不编造、绝不用常识补全、绝不猜测数字或时间。\n'+
      '4. 注意资料状态：标注「较早/某年安排」要提示以当年最新通知为准；标注「仅特定群体适用」要说明适用对象；标注「官网未明确」要如实说明。\n'+
      '5. 结合对话上下文理解追问（如「那周末呢」「怎么续借」）。\n'+
      '6. 回答末尾用一句话注明主要参考的条目编号（如「参考：LIB-001」），便于前端展示溯源。\n\n'+
      buildContext(refs);
  }

  // ---------- 调用 API（流式） ----------
  function endpoint(){ return String(cfg.baseURL||'').replace(/\/+$/,'')+'/chat/completions'; }

  function ask(question, history, onToken, onDone){
    var refs = cfg.useKB ? retrieve(question, cfg.topK) : [];
    var messages=[{role:'system',content:systemPrompt(refs)}];
    (history||[]).slice(-8).forEach(function(m){ messages.push({role:m.role,content:m.content}); });
    messages.push({role:'user',content:question});

    if(!cfg.enabled){ onDone({ok:false,reason:'disabled',refs:refs}); return; }
    if(!cfg.baseURL || !cfg.model){ onDone({ok:false,reason:'incomplete',refs:refs}); return; }

    var headers={'Content-Type':'application/json'};
    if(cfg.apiKey) headers['Authorization']='Bearer '+cfg.apiKey;

    var body={ model:cfg.model, messages:messages, temperature:Number(cfg.temperature)||0.3, stream:!!cfg.stream };
    var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ctrl.abort();}, cfg.timeout||60000) : null;

    fetch(endpoint(),{
      method:'POST', headers:headers, body:JSON.stringify(body),
      signal: ctrl?ctrl.signal:undefined
    }).then(function(resp){
      if(!resp.ok) return resp.text().then(function(t){
        var msg=t; try{ var j=JSON.parse(t); msg=(j.error&&(j.error.message||j.error))||t; }catch(e){}
        throw new Error('HTTP '+resp.status+'：'+String(msg).slice(0,300));
      });
      if(!cfg.stream || !resp.body || !resp.body.getReader){
        return resp.json().then(function(j){
          var txt=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||'';
          onToken(txt); onDone({ok:true,text:txt,refs:refs});
        });
      }
      // SSE 流式解析
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
              if(t){ full+=t; onToken(t); }
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

  // ---------- 连接测试 ----------
  function test(c, cb){
    var messages=[{role:'system',content:'只回复两个字：正常'},{role:'user',content:'测试'}];
    var headers={'Content-Type':'application/json'};
    if(c.apiKey) headers.Authorization='Bearer '+c.apiKey;
    var url=String(c.baseURL||'').replace(/\/+$/,'')+'/chat/completions';
    fetch(url,{method:'POST',headers:headers,
      body:JSON.stringify({model:c.model,messages:messages,temperature:0,stream:false,max_tokens:16})})
      .then(function(r){ return r.text().then(function(t){ return {ok:r.ok,status:r.status,text:t}; }); })
      .then(function(r){
        if(!r.ok){ var m=r.text; try{var j=JSON.parse(r.text);m=(j.error&&j.error.message)||m;}catch(e){}
          cb({ok:false,msg:'HTTP '+r.status+' '+String(m).slice(0,200)}); }
        else cb({ok:true,msg:'连接成功，模型可用'});
      })
      .catch(function(e){ cb({ok:false,msg:'请求失败：'+(e.message||e)+'（若是浏览器 CORS 报错，请改用代理地址）'}); });
  }

  // ---------- 设置面板 ----------
  function fillForm(){
    var p=PRESETS[cfg.provider]||PRESETS.custom;
    $('aiProvider').value=cfg.provider;
    $('aiBaseURL').value=cfg.baseURL||'';
    $('aiModel').value=cfg.model||'';
    $('aiKey').value=cfg.apiKey||'';
    $('aiTemp').value=cfg.temperature;
    $('aiTopK').value=cfg.topK;
    $('aiTimeout').value=cfg.timeout||60000;
    $('aiEnabled').checked=cfg.enabled;
    $('aiStream').checked=cfg.stream;
    $('aiUseKB').checked=cfg.useKB;
    $('aiPresetNote').textContent=p.note;
    updateBadge();
  }

  function updateBadge(){
    var b=$('aiBadge'); if(!b) return;
    var on=cfg.enabled && cfg.baseURL && cfg.model;
    b.textContent = on ? '🤖 AI 模式' : '📚 本地检索模式';
    b.className = 'badge '+(on?'badge-ai':'');
  }

  function openSettings(){ fillForm(); $('aiModal').classList.remove('hidden'); }
  function closeSettings(){ $('aiModal').classList.add('hidden'); }

  function bindSettings(){
    $('aiProvider').onchange=function(){
      var p=PRESETS[this.value]; if(p&&this.value!=='custom'){
        $('aiBaseURL').value=p.baseURL; $('aiModel').value=p.model; $('aiPresetNote').textContent=p.note;
      } else if(p){ $('aiPresetNote').textContent=p.note; }
    };
    $('aiSave').onclick=function(){
      cfg.provider=$('aiProvider').value;
      cfg.baseURL=$('aiBaseURL').value.trim();
      cfg.model=$('aiModel').value.trim();
      cfg.apiKey=$('aiKey').value.trim();
      cfg.temperature=parseFloat($('aiTemp').value)||0.3;
      cfg.topK=parseInt($('aiTopK').value,10)||4;
      cfg.timeout=parseInt($('aiTimeout').value,10)||60000;
      cfg.enabled=$('aiEnabled').checked;
      cfg.stream=$('aiStream').checked;
      cfg.useKB=$('aiUseKB').checked;
      save(cfg); fillForm(); closeSettings();
      if(window.HebauApp) window.HebauApp.toast(cfg.enabled?'AI 模式已启用':'已切回本地检索模式');
    };
    $('aiTest').onclick=function(){
      var c={baseURL:$('aiBaseURL').value.trim(),model:$('aiModel').value.trim(),apiKey:$('aiKey').value.trim()};
      if(!c.baseURL||!c.model){ $('aiTestMsg').textContent='请先填写接口地址和模型名'; return; }
      $('aiTestMsg').textContent='正在测试…';
      test(c,function(r){ $('aiTestMsg').textContent=(r.ok?'✅ ':'❌ ')+r.msg; });
    };
    $('aiClear').onclick=function(){
      if(!confirm('清空本机保存的 AI 配置（含 API Key）？')) return;
      cfg=clone(DEFAULT); save(cfg); fillForm();
      if(window.HebauApp) window.HebauApp.toast('配置已清空');
    };
    $('closeAi').onclick=closeSettings;
    $('aiModal').addEventListener('click',function(e){ if(e.target===$('aiModal')) closeSettings(); });
  }

  // ---------- 对外 ----------
  window.HebauAI={
    isOn:function(){ return !!(cfg.enabled && cfg.baseURL && cfg.model); },
    config:function(){ return cfg; },
    retrieve:retrieve,
    ask:ask,
    openSettings:openSettings,
    updateBadge:updateBadge,
    init:function(){ bindSettings(); fillForm(); }
  };
})();
