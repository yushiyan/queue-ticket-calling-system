(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QueueSchema = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const groups = [
    { id:'brand', title:'名称与标识', description:'统一用于登录页、取号屏和大厅展示屏。', fields:[
      ['centerName','中心名称','text','业务办理中心',1,24],
      ['slogan','欢迎标语','text','欢迎光临 · 便民服务',0,40],
      ['iconMode','大屏图标','select','text',['text','image','none'],['文字图标','上传图片','不显示']],
      ['iconText','图标文字','text','序',1,2],
      ['iconImage','图标图片','image',''],
      ['theme','大屏配色','select','navy',['navy','teal','plum'],['经典深蓝','沉静青绿','雅致紫灰']]
    ]},
    { id:'display', title:'大厅展示屏', description:'提示语与信息区域可分别调整，保存后大屏自动更新。', fields:[
      ['numberCaption','号码上方提示','text','请以下号码前往办理',1,30],
      ['notice','底部温馨提示','text','文明排队，有序办理。请留意您的号码，提前做好准备。',0,100],
      ['pausedNotice','暂停取号提示','text','暂停新取号，已取号的朋友请继续等候。',1,100],
      ['callTemplate','叫号文字','text','请 {number} 号前往 {window} 号窗口办理业务',1,120],
      ['showRecent','显示最近叫号','checkbox',true],
      ['showWait','显示等候人数','checkbox',true],
      ['showCompleted','显示已服务人数','checkbox',true],
      ['showClock','显示日期时间','checkbox',true],
      ['recentCount','最近叫号条数','number',6,1,8]
    ]},
    { id:'numbering', title:'号码规则', description:'前缀、位数与起始号须在“本轮清零”后修改，已发出的小票和历史号码不会被改写。', fields:[
      ['prefix','号码前缀','text','A',0,3],
      ['digits','数字最少位数','number',3,1,6],
      ['start','起始数字','number',1,1,999999]
    ]},
    { id:'kiosk', title:'自助取号屏', description:'调整取号页面文案与提示停留时间。', fields:[
      ['theme','竖屏背景主题','select','jade',['jade','ocean','sand','lavender'],['清新青绿','静谧蓝色','温暖米色','柔和紫色']],
      ['welcome','欢迎说明','textarea','欢迎光临，请点击下方按钮取号\n领取凭条后，请留意大厅语音广播',1,120],
      ['buttonText','取号按钮文字','text','触摸取号',1,12],
      ['ticketHint','取号成功提示','text','请妥善保管小票，过号请咨询工作人员',0,80],
      ['displaySeconds','成功提示停留秒数','number',12,5,60]
    ]},
    { id:'printing', title:'打印机与测试', description:'选择服务器电脑上已安装的打印机；留空沿用 Windows 默认打印机。保存后测试打印，不会取号或改变队列。', fields:[
      ['printerName','小票打印机','printer','',0,200]
    ]},
    { id:'ticket', title:'小票文案', description:'沿用 XP-80C 80mm 打印方案，仅替换文案。支持 {center}、{number}、{wait}、{time}。长文会自动换行。', fields:[
      ['header','小票第一行','text','{center}',0,40],
      ['title','小票第二行','text','排队凭条',0,40],
      ['numberLabel','号码提示语','text','您的排队号码是：',0,40],
      ['waitTemplate','等待人数文案','text','前方等待人数：{wait} 人',0,80],
      ['timeTemplate','时间文案','text','打印时间：{time}',0,80],
      ['footer','底部说明','textarea','请注意大厅广播，过号请重新取号',0,120]
    ]},
    { id:'voice', title:'语音叫号', description:'在服务器电脑播报。支持 {number}、{window}、{center}；内容按纯文本处理。', fields:[
      ['enabled','启用语音播报','checkbox',true],
      ['template','播报内容','textarea','请，{number}号，到，{window}号窗口，办理业务。',1,160],
      ['includePrefix','播报号码前缀和补零','checkbox',false],
      ['repeat','重复次数','number',2,1,3],
      ['rate','语速（负数较慢）','number',-1,-5,5],
      ['volume','音量','number',100,0,100],
      ['chime','播报前提示音','checkbox',true]
    ]},
    { id:'service', title:'业务规则', description:'管理全局取号容量和窗口权限。', fields:[
      ['maxWaiting','最大等候人数','number',2000,1,5000],
      ['allowSpecific','允许窗口指定等待号码叫号','checkbox',false],
      ['operatorPause','允许普通窗口暂停 / 恢复取号','checkbox',false]
    ]}
  ];
  const defaults = Object.fromEntries(groups.map(g => [g.id, Object.fromEntries(g.fields.map(f => [f[0], f[3]]))]));
  function format(num, config) { const n = config.numbering; return `${n.prefix}${String(num + n.start - 1).padStart(n.digits,'0')}`; }
  function template(text, values) { return text.replace(/\{(center|number|window|wait|time)\}/g, (all, key) => values[key] ?? all); }
  function withDefaults(input) { return Object.fromEntries(groups.map(group => [group.id, { ...defaults[group.id], ...(input?.[group.id] || {}) }])); }
  function tokensFor(group, key) {
    if (group === 'ticket') return [['{center}','中心名称'],['{number}','完整号码'],['{wait}','等待人数'],['{time}','打印时间']];
    if ((group === 'display' && key === 'callTemplate') || (group === 'voice' && key === 'template')) return [['{center}','中心名称'],['{number}','号码'],['{window}','窗口号']];
    return [];
  }
  return { groups, defaults, format, template, withDefaults, tokensFor };
});
