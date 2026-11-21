(() => {
  const tabs = Array.from(document.querySelectorAll('[data-channel]'));
  const cards = Array.from(document.querySelectorAll('[data-content-grid] [data-type]'));
  const title = document.querySelector('#works-title');
  const follow = document.querySelector('[data-follow]');
  const menuTrigger = document.querySelector('[data-menu-trigger]');

  const labels = {
    drama: 'Drama',
    membership: 'Membership',
    posts: 'Posts',
    all: 'All',
  };

  const renderChannel = (channel) => {
    tabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.channel === channel);
    });

    cards.forEach((card) => {
      const type = card.dataset.type;
      const visible = channel === 'all' || type === channel || (channel === 'all' && type === 'all');
      card.classList.toggle('is-hidden', !visible);
    });

    if (title) title.textContent = labels[channel] || 'Works';
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => renderChannel(tab.dataset.channel || 'all'));
  });

  follow?.addEventListener('click', () => {
    const active = follow.dataset.following === 'true';
    follow.dataset.following = String(!active);
    follow.textContent = active ? 'Follow' : 'Following';
  });

  menuTrigger?.addEventListener('click', () => {
    document.body.classList.toggle('menu-reference-open');
  });

  renderChannel('drama');
})();
