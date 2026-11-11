// Progressive enhancement for every page: collapsible mobile nav and a header border once scrolled.
document.documentElement.classList.add("js");

const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
const nav = document.getElementById("site-nav");

function setOpen(open: boolean): void {
  toggle?.setAttribute("aria-expanded", String(open));
  nav?.classList.toggle("is-open", open);
}

toggle?.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && toggle?.getAttribute("aria-expanded") === "true") {
    setOpen(false);
    toggle.focus();
  }
});

const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 4);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();
