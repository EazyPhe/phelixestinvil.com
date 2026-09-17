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

  window.matchMedia("(min-width: 64rem)").addEventListener("change", (event) => {
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

// Direct image links remain usable when JavaScript or native dialogs are unavailable.
const photoGalleries = [...document.querySelectorAll("[data-gallery]")];

if (photoGalleries.length && typeof HTMLDialogElement !== "undefined"
  && typeof HTMLDialogElement.prototype.showModal === "function") {
  const viewer = document.createElement("dialog");
  viewer.className = "gallery-dialog";
  viewer.id = "project-photo-viewer";
  viewer.setAttribute("aria-labelledby", "gallery-viewer-title");
  viewer.setAttribute("aria-describedby", "gallery-viewer-caption");
  viewer.innerHTML = `
    <div class="gallery-dialog-header">
      <h2 id="gallery-viewer-title"></h2>
      <button class="gallery-control gallery-close" type="button" autofocus aria-label="Close photo viewer">Close <span aria-hidden="true">×</span></button>
    </div>
    <figure class="gallery-dialog-figure">
      <div class="gallery-dialog-stage" aria-busy="false"></div>
      <figcaption id="gallery-viewer-caption"></figcaption>
    </figure>
    <div class="gallery-dialog-controls">
      <button class="gallery-control gallery-previous" type="button" aria-label="Previous photo"><span aria-hidden="true">←</span> Previous</button>
      <p class="gallery-dialog-counter"></p>
      <button class="gallery-control gallery-next" type="button" aria-label="Next photo">Next <span aria-hidden="true">→</span></button>
    </div>
    <div class="gallery-dialog-footer">
      <p class="gallery-dialog-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <a class="gallery-original" target="_blank" rel="noopener noreferrer">Open full image <span class="sr-only">(opens in a new tab)</span></a>
    </div>`;
  document.body.append(viewer);

  const title = viewer.querySelector("h2");
  const closeButton = viewer.querySelector(".gallery-close");
  const previousButton = viewer.querySelector(".gallery-previous");
  const nextButton = viewer.querySelector(".gallery-next");
  const stage = viewer.querySelector(".gallery-dialog-stage");
  const caption = viewer.querySelector("figcaption");
  const counter = viewer.querySelector(".gallery-dialog-counter");
  const status = viewer.querySelector(".gallery-dialog-status");
  const originalLink = viewer.querySelector(".gallery-original");
  let activeLinks = [];
  let activeIndex = 0;
  let trigger = null;
  let imageRequest = 0;

  const showPhoto = (index) => {
    if (!viewer.open || !activeLinks.length) return;
    activeIndex = (index + activeLinks.length) % activeLinks.length;
    const link = activeLinks[activeIndex];
    const request = ++imageRequest;
    const position = `Photo ${activeIndex + 1} of ${activeLinks.length}`;
    const description = link.dataset.caption
      || link.closest("figure")?.querySelector("figcaption")?.textContent.trim()
      || "";
    caption.textContent = description;
    counter.textContent = position;
    originalLink.href = link.href;
    previousButton.disabled = nextButton.disabled = activeLinks.length < 2;
    stage.setAttribute("aria-busy", "true");
    status.classList.remove("sr-only");
    status.textContent = `Loading ${position.toLowerCase()}…`;

    // A new element per request keeps late load/error events from replacing a newer photo.
    const photo = document.createElement("img");
    photo.className = "gallery-dialog-image";
    photo.alt = link.querySelector("img")?.alt || description;
    photo.decoding = "async";
    photo.hidden = true;
    const width = Number(link.dataset.fullWidth);
    const height = Number(link.dataset.fullHeight);
    if (width > 0 && height > 0) {
      photo.width = width;
      photo.height = height;
    }
    photo.addEventListener("load", () => {
      if (request !== imageRequest || !viewer.open) return;
      photo.hidden = false;
      stage.setAttribute("aria-busy", "false");
      status.classList.add("sr-only");
      status.textContent = `${position}${description ? `. ${description}` : ""}`;
    }, { once: true });
    photo.addEventListener("error", () => {
      if (request !== imageRequest || !viewer.open) return;
      stage.setAttribute("aria-busy", "false");
      status.textContent = `${position} could not load. Use “Open full image” to try it directly, or choose another photo.`;
    }, { once: true });
    stage.querySelector("img")?.removeAttribute("src");
    stage.replaceChildren(photo);
    photo.src = link.href;
  };

  const closeViewer = () => {
    if (viewer.open) viewer.close();
  };

  closeButton.addEventListener("click", closeViewer);
  previousButton.addEventListener("click", () => showPhoto(activeIndex - 1));
  nextButton.addEventListener("click", () => showPhoto(activeIndex + 1));
  viewer.addEventListener("close", () => {
    // Ignore a queued close event if the dialog has already been reopened.
    if (viewer.open) return;
    imageRequest += 1;
    stage.querySelector("img")?.removeAttribute("src");
    stage.replaceChildren();
    stage.setAttribute("aria-busy", "false");
    originalLink.removeAttribute("href");
    status.textContent = "";
    document.documentElement.classList.remove("gallery-viewer-open");
    activeLinks = [];
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = null;
  });

  viewer.addEventListener("click", (event) => {
    if (event.target !== viewer) return;
    const bounds = viewer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom) closeViewer();
  });

  viewer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      // Retain native Escape-to-close without also changing the underlying mobile menu.
      event.stopPropagation();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showPhoto(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      showPhoto(event.key === "Home" ? 0 : activeLinks.length - 1);
    } else if (event.key === "Tab") {
      const controls = [...viewer.querySelectorAll("button:not(:disabled), a[href]")]
        .filter((control) => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  photoGalleries.forEach((gallery) => {
    const links = [...gallery.querySelectorAll("a[data-gallery-image][href]")];
    links.forEach((link, index) => {
      link.setAttribute("aria-haspopup", "dialog");
      link.setAttribute("aria-controls", viewer.id);
      link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0
          || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        trigger = link;
        activeLinks = links;
        const label = (gallery.getAttribute("aria-labelledby") || "").split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).join(" ");
        title.textContent = label || "Project photographs";
        if (!viewer.open) viewer.showModal();
        document.documentElement.classList.add("gallery-viewer-open");
        showPhoto(index);
        closeButton.focus({ preventScroll: true });
      });
    });
  });
}
