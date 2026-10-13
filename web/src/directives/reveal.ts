import type { Directive } from 'vue';

/** v-reveal：元素进入视口时淡入上移（Linear 式）。 */
export const vReveal: Directive<HTMLElement> = {
  mounted(el, binding) {
    // prefers-reduced-motion 直接显示
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('in');
      return;
    }
    el.classList.add('reveal');
    if (binding.value?.delay) el.style.transitionDelay = `${binding.value.delay}ms`;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('in');
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
  },
};