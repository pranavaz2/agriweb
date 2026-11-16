(() => {
  'use strict';

  const LANGUAGE_KEY = 'purayidakrishi-language';
  const supportedLanguages = new Set(['en', 'ml']);
  let currentLanguage = 'ml';

  const copy = {
    en: {
      contactLoading: 'Sending your message…',
      contactSuccess: 'Your message was received. Thank you for contacting Purayidakrishi.',
      contactError: 'We could not submit your message. Please try again or contact us by phone or WhatsApp.',
      contactNotConfigured: 'The contact form is not connected yet. Please call or WhatsApp our team directly.',
      registrationLoading: 'Submitting your enquiry…',
      registrationSuccess: 'Your registration enquiry was received. The team will contact you to confirm the course details.',
      registrationError: 'We could not submit your enquiry. Please try again or contact the team by WhatsApp.',
      registrationNotConfigured: 'Online registration is not connected yet. Please WhatsApp or call the team to register your interest.',
      invalidFile: 'Please upload a JPG, PNG, WebP or PDF file no larger than 5 MB.',
      invalidForm: 'Please complete all required fields and accept the consent checkbox.',
      switchTo: 'Switch to Malayalam',
      openMenu: 'Open navigation menu',
      closeMenu: 'Close navigation menu'
    },
    ml: {
      contactLoading: 'സന്ദേശം അയയ്ക്കുന്നു…',
      contactSuccess: 'നിങ്ങളുടെ സന്ദേശം ലഭിച്ചു. പുരയിടക്കൃഷിയുമായി ബന്ധപ്പെടുന്നതിന് നന്ദി.',
      contactError: 'സന്ദേശം അയയ്ക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക, അല്ലെങ്കിൽ ഫോൺ / വാട്സ്ആപ്പ് വഴി ബന്ധപ്പെടുക.',
      contactNotConfigured: 'കോൺടാക്റ്റ് ഫോം ഇതുവരെ ബന്ധിപ്പിച്ചിട്ടില്ല. ദയവായി ഫോൺ അല്ലെങ്കിൽ വാട്സ്ആപ്പ് വഴി ബന്ധപ്പെടുക.',
      registrationLoading: 'നിങ്ങളുടെ അന്വേഷണം സമർപ്പിക്കുന്നു…',
      registrationSuccess: 'രജിസ്ട്രേഷൻ അന്വേഷണം ലഭിച്ചു. കോഴ്‌സ് വിവരങ്ങൾ സ്ഥിരീകരിക്കാൻ ടീം നിങ്ങളെ ബന്ധപ്പെടും.',
      registrationError: 'അന്വേഷണം സമർപ്പിക്കാനായില്ല. വീണ്ടും ശ്രമിക്കുക, അല്ലെങ്കിൽ വാട്സ്ആപ്പ് വഴി ബന്ധപ്പെടുക.',
      registrationNotConfigured: 'ഓൺലൈൻ രജിസ്ട്രേഷൻ ഇതുവരെ ബന്ധിപ്പിച്ചിട്ടില്ല. താൽപര്യം അറിയിക്കാൻ ഫോൺ / വാട്സ്ആപ്പ് വഴി ബന്ധപ്പെടുക.',
      invalidFile: '5 MB-യിൽ താഴെയുള്ള JPG, PNG, WebP അല്ലെങ്കിൽ PDF ഫയൽ മാത്രം അപ്‌ലോഡ് ചെയ്യുക.',
      invalidForm: 'നിർബന്ധമായ വിവരങ്ങൾ പൂരിപ്പിച്ച് സമ്മത ചെക്ക്ബോക്സ് തിരഞ്ഞെടുക്കുക.',
      switchTo: 'ഇംഗ്ലീഷിലേക്ക് മാറ്റുക',
      openMenu: 'നാവിഗേഷൻ മെനു തുറക്കുക',
      closeMenu: 'നാവിഗേഷൻ മെനു അടയ്ക്കുക'
    }
  };

  function readSavedLanguage() {
    try {
      const saved = window.localStorage.getItem(LANGUAGE_KEY);
      return supportedLanguages.has(saved) ? saved : 'ml';
    } catch {
      return 'ml';
    }
  }

  function updateLanguage(nextLanguage, persist = true) {
    if (!supportedLanguages.has(nextLanguage)) return;
    currentLanguage = nextLanguage;
    document.documentElement.lang = currentLanguage;
    document.body.classList.toggle('is-malayalam', currentLanguage === 'ml');

    document.querySelectorAll('[data-en][data-ml]').forEach((element) => {
      element.textContent = element.dataset[currentLanguage];
    });

    document.querySelectorAll('[data-placeholder-en][data-placeholder-ml]').forEach((element) => {
      element.placeholder = element.dataset[`placeholder${currentLanguage === 'en' ? 'En' : 'Ml'}`];
    });

    document.querySelectorAll('[data-language-toggle]').forEach((button) => {
      button.textContent = currentLanguage === 'ml' ? 'English' : 'മലയാളം';
      button.setAttribute('aria-label', copy[currentLanguage].switchTo);
    });

    document.querySelectorAll('.menu-toggle').forEach((button) => {
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-label', isExpanded ? copy[currentLanguage].closeMenu : copy[currentLanguage].openMenu);
    });

    const contactStatus = document.getElementById('contact-status');
    const registrationStatus = document.getElementById('registration-status');
    if (contactStatus && contactStatus.textContent.trim()) contactStatus.textContent = '';
    if (registrationStatus && registrationStatus.textContent.trim()) registrationStatus.textContent = '';

    if (persist) {
      try { window.localStorage.setItem(LANGUAGE_KEY, currentLanguage); } catch { /* Storage may be unavailable in private browsing. */ }
    }
  }

  document.querySelectorAll('[data-language-toggle]').forEach((button) => {
    button.addEventListener('click', () => updateLanguage(currentLanguage === 'ml' ? 'en' : 'ml'));
  });

  const menuToggle = document.querySelector('.menu-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');
  function closeMenu() {
    if (!menuToggle || !mobileMenu) return;
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', copy[currentLanguage].openMenu);
    mobileMenu.hidden = true;
  }
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      const open = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? copy[currentLanguage].closeMenu : copy[currentLanguage].openMenu);
      mobileMenu.hidden = !open;
    });
    mobileMenu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
    document.addEventListener('click', (event) => {
      if (!mobileMenu.hidden && !mobileMenu.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
    });
  }

  const currentYear = document.getElementById('current-year');
  if (currentYear) currentYear.textContent = String(new Date().getFullYear());

  function setFormStatus(element, message, state) {
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  async function postJSON(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  }

  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('contact-status');
      if (!contactForm.reportValidity()) {
        setFormStatus(status, copy[currentLanguage].invalidForm, 'error');
        return;
      }
      const submitButton = contactForm.querySelector('button[type="submit"]');
      const formData = new FormData(contactForm);
      const payload = {
        name: String(formData.get('name') || '').trim(),
        email: String(formData.get('email') || '').trim(),
        subject: String(formData.get('subject') || '').trim(),
        message: String(formData.get('message') || '').trim(),
        language: currentLanguage,
        consent: formData.get('consent') === 'on'
      };
      submitButton.disabled = true;
      setFormStatus(status, copy[currentLanguage].contactLoading, 'loading');
      try {
        const { response, result } = await postJSON('/api/contact', payload);
        if (response.ok && result.ok) {
          setFormStatus(status, copy[currentLanguage].contactSuccess, 'success');
          contactForm.reset();
        } else if (response.status === 503) {
          setFormStatus(status, copy[currentLanguage].contactNotConfigured, 'error');
        } else {
          setFormStatus(status, copy[currentLanguage].contactError, 'error');
        }
      } catch {
        setFormStatus(status, copy[currentLanguage].contactError, 'error');
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  const registrationForm = document.getElementById('registration-form');
  if (registrationForm) {
    registrationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = document.getElementById('registration-status');
      if (!registrationForm.reportValidity()) {
        setFormStatus(status, copy[currentLanguage].invalidForm, 'error');
        return;
      }
      const fileInput = registrationForm.querySelector('input[name="paymentProof"]');
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (file && (file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))) {
        setFormStatus(status, copy[currentLanguage].invalidFile, 'error');
        return;
      }
      const submitButton = registrationForm.querySelector('button[type="submit"]');
      const formData = new FormData(registrationForm);
      formData.append('language', currentLanguage);
      submitButton.disabled = true;
      setFormStatus(status, copy[currentLanguage].registrationLoading, 'loading');
      try {
        const response = await fetch('/api/registrations', { method: 'POST', body: formData, headers: { 'Accept': 'application/json' } });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.ok) {
          setFormStatus(status, copy[currentLanguage].registrationSuccess, 'success');
          registrationForm.reset();
        } else if (response.status === 503) {
          setFormStatus(status, copy[currentLanguage].registrationNotConfigured, 'error');
        } else {
          setFormStatus(status, copy[currentLanguage].registrationError, 'error');
        }
      } catch {
        setFormStatus(status, copy[currentLanguage].registrationError, 'error');
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  updateLanguage(readSavedLanguage(), false);
})();
