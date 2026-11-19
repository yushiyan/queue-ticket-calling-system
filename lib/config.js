const fs = require('fs');
const { groups, defaults, withDefaults } = require('../assets/settings-schema');
function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('设置格式无效');
  const result = {};
  for (const group of groups) {
    const source = input[group.id];
    if (!source || typeof source !== 'object') throw new Error(`缺少设置：${group.title}`);
    result[group.id] = {};
    for (const [key, label, type, initial, min, max] of group.fields) {
      const value = source[key];
      let valid;
      if (type === 'checkbox') valid = typeof value === 'boolean';
      else if (type === 'number') valid = Number.isInteger(value) && value >= min && value <= max;
      else if (type === 'select') valid = min.includes(value);
      else if (type === 'image') {
        valid = value === '';
        if (typeof value === 'string' && value.length < 350000) {
          const match = /^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/.exec(value);
          if (match) {
            const bytes = Buffer.from(match[2], 'base64');
            valid = (match[1] === 'png' && bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a')
              || (match[1] === 'jpeg' && bytes.subarray(0,3).toString('hex') === 'ffd8ff')
              || (match[1] === 'webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP');
          }
        }
      } else valid = typeof value === 'string' && value.length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
      if (!valid) throw new Error(`${label}格式或范围不正确`);
      result[group.id][key] = value;
    }
  }
  if (!/^[A-Za-z0-9\u4e00-\u9fff]{0,3}$/.test(result.numbering.prefix)) throw new Error('号码前缀仅支持最多 3 位字母、数字或汉字');
  if (/[\r\n\u0000]/.test(result.printing.printerName)) throw new Error('打印机名称格式不正确');
  if (result.brand.iconMode === 'image' && !result.brand.iconImage) throw new Error('请先上传图标图片，或选择其他图标模式');
  for (const text of [result.voice.template, result.display.callTemplate]) if (!text.includes('{number}') || !text.includes('{window}')) throw new Error('叫号文案必须包含 {number} 和 {window}');
  return result;
}
class Config {
  constructor(file) {
    this.file = file;
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { revision:0, values:defaults };
    this.revision = saved.revision;
    if (!Number.isSafeInteger(this.revision) || this.revision < 0) throw new Error('设置版本数据异常，请检查备份');
    this.values = validate(withDefaults(saved.values));
  }
  save(values, revision) {
    if (revision !== this.revision) throw new Error('设置已被其他管理员修改，请重新加载后再保存');
    const next = validate(values);
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ revision:this.revision + 1, values:next }, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    this.values = next; this.revision++;
  }
}
module.exports = { Config, validate };
