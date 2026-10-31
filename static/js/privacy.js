(function setupPrivacyScroll() {
    const toggle = document.getElementById('privacy-toggle');
    const scroll = document.getElementById('privacy-scroll');
    if (!toggle || !scroll) return;

    const title = document.getElementById('privacy-title');
    const page = toggle.closest('.page');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let closeTimer;

    function positionSheet() {
        const bounds = page.getBoundingClientRect();
        const style = getComputedStyle(page);
        const leftPadding = parseFloat(style.paddingLeft);
        const rightPadding = parseFloat(style.paddingRight);
        // Anchor above the footer, leaving reading room on short screens.
        const bottom = Math.max(24, Math.min(
            window.innerHeight - toggle.getBoundingClientRect().top + 12,
            window.innerHeight - 344
        ));
        scroll.style.setProperty('--privacy-left', bounds.left + leftPadding + 'px');
        scroll.style.setProperty('--privacy-width', bounds.width - leftPadding - rightPadding + 'px');
        scroll.style.setProperty('--privacy-bottom', bottom + 'px');
        scroll.style.setProperty('--privacy-height', window.innerHeight - bottom - 24 + 'px');
    }

    function finishClose() {
        clearTimeout(closeTimer);
        if (scroll.open) scroll.close();
    }

    function close() {
        if (!scroll.open) return;
        scroll.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        clearTimeout(closeTimer);
        if (reduceMotion.matches) finishClose();
        else closeTimer = setTimeout(finishClose, 600);
    }

    toggle.addEventListener('click', () => {
        if (scroll.open) {
            close();
            return;
        }
        positionSheet();
        document.body.classList.add('privacy-open');
        scroll.showModal();
        scroll.querySelector('.privacy-sheet').scrollTop = 0;
        title.focus({ preventScroll: true });
        scroll.offsetHeight; // Start the grid at 0fr before revealing upward.
        scroll.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
    });

    scroll.querySelector('.privacy-close').addEventListener('click', close);
    scroll.addEventListener('cancel', event => {
        event.preventDefault();
        close();
    });
    scroll.addEventListener('click', event => {
        // Backdrop clicks target the native dialog itself.
        if (event.target === scroll) close();
    });
    scroll.addEventListener('close', () => {
        clearTimeout(closeTimer);
        scroll.classList.remove('open');
        document.body.classList.remove('privacy-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus({ preventScroll: true });
    });
    scroll.addEventListener('transitionend', event => {
        if (event.target === scroll && event.propertyName === 'grid-template-rows' && !scroll.classList.contains('open')) {
            finishClose();
        }
    });
    window.addEventListener('resize', () => {
        if (scroll.open) positionSheet();
    });
})();
