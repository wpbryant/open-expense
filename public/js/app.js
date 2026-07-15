// Mobile slide-out navigation: hamburger toggles the off-canvas drawer.
(function () {
  const toggle = document.getElementById("navToggle");
  const backdrop = document.getElementById("navBackdrop");
  if (!toggle) return;
  const setOpen = (open) => {
    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };
  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("nav-open")));
  if (backdrop) backdrop.addEventListener("click", () => setOpen(false));
  document.querySelectorAll("#navDrawer .nav a").forEach((a) =>
    a.addEventListener("click", () => setOpen(false))
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  // Reset if resized back to desktop.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) setOpen(false);
  });
})();

// Progressive enhancement: register the service worker and add a live image
// preview when uploading receipts. Nothing here is required for the app to
// work — forms post normally.

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Receipt upload: show a thumbnail preview of the chosen file before submit.
(function () {
  const input = document.getElementById("receipt-input");
  const preview = document.getElementById("receipt-preview");
  const label = document.getElementById("file-name");
  if (!input || !preview) return;

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (label) label.textContent = file.name + " (" + Math.round(file.size / 1024) + " KB)";
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.style.display = "block";
      };
      reader.readAsDataURL(file);
    } else {
      preview.style.display = "none"; // PDFs can't preview in an <img>
    }
  });
})();

// Scan form: show a processing state while the receipt is being uploaded +
// read by Gemini, and block re-submission until the response arrives.
(function () {
  const form = document.getElementById("scan-form");
  if (!form) return;
  const btn = document.getElementById("scan-submit");
  const status = document.getElementById("scan-status");

  form.addEventListener("submit", (ev) => {
    if (btn && btn.disabled) {
      ev.preventDefault();
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Processing…";
    }
    // NOTE: do NOT disable the file input here — a disabled input is dropped
    // from the form submission, so the server would see no file. The disabled
    // submit button is enough to prevent a double-submit.
    if (status) status.hidden = false;
  });
})();

// Auto-dismiss flash messages after a few seconds.
(function () {
  document.querySelectorAll(".flash").forEach((el) => {
    setTimeout(() => {
      el.style.transition = "opacity .4s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 450);
    }, 4500);
  });
})();

// Receipt crop (expense edit page): open a cropperjs lightbox, POST the crop
// box to the server, and swap the stored image in place. The overlay markup is
// only rendered for saved image receipts, so this no-ops on every other page.
(function () {
  const overlay = document.querySelector(".crop-overlay");
  const img = document.getElementById("crop-image");
  if (!overlay || !img || typeof Cropper === "undefined") return;

  const btn = document.getElementById("crop-btn");
  const applyBtn = document.getElementById("crop-apply");
  const cancelBtn = document.getElementById("crop-cancel");
  const errEl = document.getElementById("crop-error");
  const receiptImg = document.getElementById("receipt-img");
  const pathInput = document.getElementById("receipt-path-input");
  const dl = document.getElementById("receipt-download");
  let cropper = null;

  const close = () => {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    overlay.hidden = true;
    errEl.hidden = true;
  };

  const open = () => {
    errEl.hidden = true;
    overlay.hidden = false;
    if (cropper) cropper.destroy();
    img.src = btn.dataset.src;
    cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 0.9,
      scalable: false,
      zoomable: true,
      rotatable: false,
      background: false,
    });
  };

  btn.addEventListener("click", open);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) close();
  });

  applyBtn.addEventListener("click", async () => {
    if (!cropper) return;
    const d = cropper.getData(true); // {x, y, width, height} rounded, natural px
    if (!(d.width > 0) || !(d.height > 0)) return;
    const origText = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = "⏳ Cropping…";
    errEl.hidden = true;
    try {
      const params = new URLSearchParams({
        left: d.x,
        top: d.y,
        width: d.width,
        height: d.height,
      });
      const res = await fetch("/expenses/" + btn.dataset.expenseId + "/receipt/crop", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Crop failed.");
      }
      const data = await res.json();
      if (receiptImg) receiptImg.src = data.previewUrl;
      if (pathInput) pathInput.value = data.path;
      if (dl) dl.href = data.downloadUrl;
      btn.dataset.src = data.previewUrl;
      close();
    } catch (e2) {
      errEl.textContent = e2.message || "Could not crop the image.";
      errEl.hidden = false;
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = origText;
    }
  });
})();
