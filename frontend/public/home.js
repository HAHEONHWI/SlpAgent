const form = document.querySelector(".mask-demo");
const output = document.querySelector(".mask-output");
const button = form.querySelector("button");
let autoSendTimer;

function playMask() {
  observer.disconnect();
  clearTimeout(autoSendTimer);
  button.classList.remove("is-auto-press");
  output.hidden = false;
  output.classList.remove("is-masking");
  // Reflow restarts the inline masks when the same example is sent again.
  void output.offsetWidth;
  output.classList.add("is-masking");
}

const observer = new IntersectionObserver((entries) => {
  if (!entries.some((entry) => entry.intersectionRatio >= 0.5)) return;
  observer.disconnect();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    button.click();
    return;
  }
  button.classList.add("is-auto-press");
  autoSendTimer = setTimeout(() => button.click(), 360);
}, { threshold: 0.5, rootMargin: "0px 0px -48px 0px" });

observer.observe(button);
button.disabled = false;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  playMask();
});

const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-visible");
    revealObserver.unobserve(entry.target);
  }
}, { rootMargin: "0px 0px -48px 0px" });

document.querySelectorAll("#recording, #features, #erp").forEach((section) => {
  section.classList.add("reveal-pending");
  revealObserver.observe(section);
});

const reviewButton = document.querySelector(".review-button");
const reviewResult = document.querySelector(".review-result");
const draftLabel = document.querySelector(".draft-label");
reviewButton.disabled = false;
reviewButton.addEventListener("click", () => {
  reviewResult.hidden = false;
  reviewResult.classList.remove("is-reflected");
  void reviewResult.offsetWidth;
  reviewResult.classList.add("is-reflected");
  draftLabel.textContent = "검토 완료";
  draftLabel.classList.add("is-approved");
  reviewButton.textContent = "다시 보기";
});
