(function () {
  const API_BASE = '/api';
  const TOKEN_KEY = 'loveSwipeAuthToken';

  window.Auth = {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,

    async request(path, method = 'GET', body = null) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;

        const response = await fetch(API_BASE + path, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        });

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          console.error('Response is not JSON:', text);
          throw new Error('El servidor no respondió con formato JSON válido.');
        }

        if (!response.ok) {
          throw new Error(data.error || `Error ${response.status}: ${response.statusText}`);
        }

        return data;
      } catch (error) {
        console.error('API request error:', error);
        if (!error.message.includes('Failed to fetch')) {
          showToast(error.message || 'Error en la conexión con el servidor.');
        }
        return null;
      }
    },

    saveToken(token) {
      this.token = token;
      localStorage.setItem(TOKEN_KEY, token);
    },

    clearToken() {
      this.token = null;
      localStorage.removeItem(TOKEN_KEY);
      this.user = null;
      State.isLoggedIn = false;
      State.isPremium = false;
      localStorage.setItem('isPremium', 'false');
      updateAuthUi();
      if (typeof Filters !== 'undefined') Filters.render();
    },

    async restore() {
      if (!this.token) return;
      const data = await this.request('/me', 'GET');
      if (data && data.user) {
        this.user = data.user;
        State.isLoggedIn = true;
        State.isPremium = data.user.role === 'premium';
        localStorage.setItem('isPremium', String(State.isPremium));
        updateAuthUi();
        renderMyProfile();
        if (typeof Filters !== 'undefined') Filters.render();
      } else {
        this.clearToken();
      }
    }
  };

  function getInputValue(form, selector) {
    const field = form.querySelector(selector);
    return field ? field.value.trim() : '';
  }

  function updateAuthUi() {
    const profileButton = document.getElementById('myProfileBtn');
    if (profileButton) {
      profileButton.style.display = window.Auth.user ? 'inline-flex' : 'none';
    }

    if (window.Auth.user) {
      const welcome = document.getElementById('welcomeText');
      if (welcome) {
        welcome.textContent = `Hola, ${window.Auth.user.name || window.Auth.user.email}`;
      }
    }
  }

  async function refreshUser() {
    const data = await window.Auth.request('/me', 'GET');
    if (data && data.user) {
      window.Auth.user = data.user;
      State.isPremium = data.user.role === 'premium';
      localStorage.setItem('isPremium', String(State.isPremium));
      renderMyProfile();
      if (typeof Filters !== 'undefined') Filters.render();
      updateAuthUi();
      if (State.isPremium) {
        showSection('confirmation');
        showToast('Pago confirmado. Rol premium activado.');
      }
    }
  }

  window.handleAuth = async function (mode = 'login') {
    const registerForm = document.getElementById('formReg');
    const loginForm = document.getElementById('formLog');

    if (mode === 'register' && registerForm) {
      const name = getInputValue(registerForm, 'input[type="text"]');
      const email = getInputValue(registerForm, 'input[type="email"]');
      const password = getInputValue(registerForm, 'input[type="password"]');

      if (!name || !email || !password) {
        showToast('Completa todos los campos para registrarte.');
        return;
      }

      const data = await window.Auth.request('/register', 'POST', { name, email, password });
      if (data && data.token) {
        window.Auth.saveToken(data.token);
        window.Auth.user = data.user;
        State.isLoggedIn = true;
        State.isPremium = data.user.role === 'premium';
        localStorage.setItem('isPremium', String(State.isPremium));
        updateAuthUi();
        renderMyProfile();
        if (typeof Filters !== 'undefined') Filters.render();
        closeModal();
        showToast('Cuenta creada con éxito. Ahora puedes comprar Premium.');
      }
      return;
    }

    if (mode === 'login' && loginForm) {
      const email = getInputValue(loginForm, 'input[type="email"]');
      const password = getInputValue(loginForm, 'input[type="password"]');
      if (!email || !password) {
        showToast('Introduce email y contraseña para iniciar sesión.');
        return;
      }

      const data = await window.Auth.request('/login', 'POST', { email, password });
      if (data && data.token) {
        window.Auth.saveToken(data.token);
        window.Auth.user = data.user;
        State.isLoggedIn = true;
        State.isPremium = data.user.role === 'premium';
        localStorage.setItem('isPremium', String(State.isPremium));
        updateAuthUi();
        renderMyProfile();
        if (typeof Filters !== 'undefined') Filters.render();
        closeModal();
        showToast('Sesión iniciada. Ya puedes comprar Premium.');
      }
      return;
    }

    showToast('Selecciona un modo de autenticación válido.');
  };

  window.Payment.processPayment = async function () {
    if (!this.selectedMethod) {
      showToast('Selecciona un método de pago.');
      return;
    }

    if (!window.Auth.user) {
      showToast('Inicia sesión antes de realizar el pago.');
      openModal('login');
      return;
    }

    if (!State.cart.length) {
      showToast('Tu carrito está vacío.');
      return;
    }

    const planKey = Object.entries(Premium.plans).find(([, plan]) => plan.name === State.cart[0].name)?.[0];
    if (!planKey) {
      showToast('Plan de pago inválido.');
      return;
    }

    const data = await window.Auth.request('/create-checkout-session', 'POST', { plan: planKey });
    if (data && data.url) {
      window.location.href = data.url;
    }
  };

  document.addEventListener('DOMContentLoaded', async function () {
    await window.Auth.restore();

    if (window.location.search.includes('session_id')) {
      await refreshUser();
    }

    if (window.location.search.includes('checkout=cancelled')) {
      showToast('Pago cancelado. Mantienes el rol Free.');
    }
  });
})();
