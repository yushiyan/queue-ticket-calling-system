(function() {
  let brandSignature = '';
  function apply(config) {
    if (!config) return;
    document.querySelectorAll('[data-center]').forEach(el => { el.textContent = config.brand.centerName; });
    document.querySelectorAll('[data-slogan]').forEach(el => { el.textContent = config.brand.slogan; });
    if (document.body.dataset.pageTitle) document.title = `${document.body.dataset.pageTitle} · ${config.brand.centerName}`;
    document.body.dataset.theme = config.brand.theme;
    const icon = document.getElementById('brand-icon');
    if (icon) {
      const signature = JSON.stringify([config.brand.iconMode, config.brand.iconText, config.brand.iconImage]);
      if (signature !== brandSignature) {
        icon.hidden = config.brand.iconMode === 'none';
        if (config.brand.iconMode === 'image') { const img = document.createElement('img'); img.src = config.brand.iconImage; img.alt = ''; icon.replaceChildren(img); }
        else icon.textContent = config.brand.iconText;
        brandSignature = signature;
      }
    }
  }
  function label(item, config) { return item?.label || (item?.num ? QueueSchema.format(item.num, config || QueueSchema.defaults) : '—'); }
  window.QueueUI = { apply, label };
})();
