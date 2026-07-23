(() => {
  const finePointer = window.matchMedia("(pointer: fine) and (min-width: 769px)");

  if (!finePointer.matches) {
    return;
  }

  const cursor = document.createElement("div");
  const ring = document.createElement("div");
  cursor.id = "arc-cursor";
  ring.id = "arc-cursor-ring";
  cursor.setAttribute("aria-hidden", "true");
  ring.setAttribute("aria-hidden", "true");
  document.body.append(cursor, ring);
  document.documentElement.classList.add("arc-custom-cursor");

  let mouseX = 0;
  let mouseY = 0;
  let ringX = 0;
  let ringY = 0;
  let frameId = 0;

  const render = () => {
    ringX += (mouseX - ringX) * .14;
    ringY += (mouseY - ringY) * .14;
    cursor.style.left = `${mouseX}px`;
    cursor.style.top = `${mouseY}px`;
    ring.style.left = `${ringX}px`;
    ring.style.top = `${ringY}px`;
    frameId = window.requestAnimationFrame(render);
  };

  const setActive = (active) => {
    cursor.classList.toggle("is-active", active);
    ring.classList.toggle("is-active", active);
  };

  document.addEventListener("pointermove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    cursor.classList.add("is-visible");
    ring.classList.add("is-visible");
  }, { passive: true });

  document.addEventListener("pointerover", (event) => {
    setActive(Boolean(event.target.closest("a, button, input, textarea, select, label, [role='button']")));
  });

  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) {
      cursor.classList.remove("is-visible");
      ring.classList.remove("is-visible");
      setActive(false);
      return;
    }

    setActive(Boolean(event.relatedTarget.closest?.("a, button, input, textarea, select, label, [role='button']")));
  });

  window.addEventListener("pagehide", () => {
    window.cancelAnimationFrame(frameId);
  }, { once: true });

  render();
})();
