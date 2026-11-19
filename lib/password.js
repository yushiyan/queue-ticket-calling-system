const fs = require('fs');
const crypto = require('crypto');

class PasswordSettings {
  constructor(file, initial = '000000') {
    this.file = file;
    if (fs.existsSync(file)) this.value = JSON.parse(fs.readFileSync(file, 'utf8'));
    else this.save(initial);
    if (!/^[a-f0-9]{32}$/.test(this.value.salt) || !/^[a-f0-9]{128}$/.test(this.value.hash)) throw new Error('密码设置文件损坏，请检查备份');
  }
  verify(password) {
    if (typeof password !== 'string' || password.length > 64) return false;
    const hash = crypto.scryptSync(password, this.value.salt, 64);
    return crypto.timingSafeEqual(hash, Buffer.from(this.value.hash, 'hex'));
  }
  save(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const value = { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
    this.value = value;
  }
}
module.exports = PasswordSettings;
