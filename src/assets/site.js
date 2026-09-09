const menuButton = document.querySelector("[data-menu-button]");
const navigation = document.querySelector("[data-navigation]");

if (menuButton && navigation) {
  if (!navigation.id) navigation.id = "primary-navigation";
  menuButton.setAttribute("aria-controls", navigation.id);

  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    navigation.removeAttribute("data-open");
  };

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    navigation.toggleAttribute("data-open", !isOpen);
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      closeMenu();
      menuButton.focus();
    }
  });

  window.matchMedia("(min-width: 56rem)").addEventListener("change", (event) => {
    if (event.matches) closeMenu();
  });
}

const mobileDuties = window.matchMedia("(max-width: 38rem)");

document.querySelectorAll(".role-duties").forEach((list, index) => {
  const responsibilityCount = [...list.children].filter((item) => item.tagName === "LI").length;
  if (responsibilityCount <= 2) return;

  if (!list.id) {
    let listId = `role-duties-${index + 1}`;
    while (document.getElementById(listId)) listId += "-list";
    list.id = listId;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "duties-toggle";
  toggle.setAttribute("aria-controls", list.id);
  list.setAttribute("data-collapsible", "");

  let mobileExpanded = false;
  const updateDuties = () => {
    const expanded = !mobileDuties.matches || mobileExpanded;
    list.setAttribute("data-expanded", String(expanded));
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded
      ? "Show fewer responsibilities"
      : `Show all ${responsibilityCount} responsibilities`;
  };

  toggle.addEventListener("click", () => {
    mobileExpanded = !mobileExpanded;
    updateDuties();
  });

  mobileDuties.addEventListener("change", updateDuties);
  list.insertAdjacentElement("afterend", toggle);
  updateDuties();
});

const sectionLinks = [...document.querySelectorAll('[data-navigation] a[href^="#"]')];
const sections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if (sections.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;
      sectionLinks.forEach((link) => {
        const active = link.getAttribute("href") === `#${visible.target.id}`;
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    },
    { rootMargin: "-20% 0px -65%", threshold: [0.05, 0.25, 0.5] }
  );

  sections.forEach((section) => observer.observe(section));
}
