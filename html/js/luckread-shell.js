(() => {
  "use strict";

  const toggle = document.querySelector(".lr-nav-toggle");
  const nav = document.querySelector("#lr-primary-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("is-open", !expanded);
    });

    nav.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement && window.matchMedia("(max-width: 820px)").matches) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
      }
    });
  }

  document.querySelectorAll("[data-lr-year]").forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });
})();
