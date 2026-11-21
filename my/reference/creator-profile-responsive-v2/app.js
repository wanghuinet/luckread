(() => {
  'use strict';

  const tabs = [...document.querySelectorAll('[data-channel]')];
  const cards = [...document.querySelectorAll('[data-grid] [data-type]')];
  const title = document.querySelector('#works-title');
  const followButton = document.querySelector('[data-follow]');
  const menuButton = document.querySelector('[data-menu]');
  const shareButtons = [...document.querySelectorAll('[data-share]')];

  const labels = {
    drama: 'Drama',
    membership: 'Membership',
    posts: 'Posts',
    all: 'All',
  };

  function renderChannel(channel) {
    for (const tab of tabs) {
      const active = tab.dataset.channel === channel;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }

    for (const card of cards) {
      card.classList.toggle(
        'is-hidden',
        channel !== 'all' && card.dataset.type !== channel,
      );
    }

    if (title) title.textContent = labels[channel] || 'Works';
  }

  async function shareProfile() {
    const data = {
      title: document.title,
      text: 'Creator profile reference',
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // Optional progressive enhancement.
    }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      renderChannel(tab.dataset.channel || 'all');
    });
  }

  followButton?.addEventListener('click', () => {
    const next = followButton.dataset.following !== 'true';
    followButton.dataset.following = String(next);
    followButton.textContent = next ? 'Following' : 'Follow';
  });

  for (const button of shareButtons) {
    button.addEventListener('click', () => void shareProfile());
  }

  menuButton?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-reference-open');
    menuButton.setAttribute('aria-expanded', String(open));
  });

  renderChannel('drama');
})();
