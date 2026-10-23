
(() => {
  "use strict";

  const CONFIG_KEY = "tempo.supabase.config.v1";
  const LOGIN_PAGE = "login.html";
  const APP_PAGE = "index.html";

  const $ = (selector) => document.querySelector(selector);

  let client = null;
  let recoveryMode = false;

  function readConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveConfig(url, key) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
  }

  function getClient() {
    const config = readConfig();

    if (!config.url || !config.key) {
      throw new Error(
        "Configure d'abord l'URL et la clé publique de Supabase."
      );
    }

    if (!window.supabase?.createClient) {
      throw new Error("Le SDK Supabase n'est pas disponible.");
    }

    if (!client) {
      client = window.supabase.createClient(config.url, config.key);
    }

    return client;
  }

  function message(text, success = false) {
    const el = $("#authMessage");
    if (!el) return;

    el.textContent = text;
    el.style.color = success ? "#15803d" : "#b42318";
  }

  function setBusy(busy, text) {
    const login = $("#loginBtn");
    const signup = $("#signupBtn");
    const reset = $("#resetBtn");

    if (login) {
      login.disabled = busy;
      if (text) login.textContent = text;
    }

    if (signup) signup.disabled = busy;
    if (reset) reset.disabled = busy;
  }

  function isLoginPage() {
    return !!$("#loginForm");
  }

  function goToApp() {
    window.location.replace(APP_PAGE);
  }

  // --------------------------------------------------
  // PAGE DE CONNEXION
  // --------------------------------------------------

  async function initLoginPage() {
    const config = readConfig();

    $("#supabaseUrl").value = config.url || "";
    $("#supabaseKey").value = config.key || "";

    $("#saveConfigBtn").addEventListener("click", () => {
      const url = $("#supabaseUrl").value.trim();
      const key = $("#supabaseKey").value.trim();

      if (!url || !key) {
        message("Renseigne l'URL et la clé publique Supabase.");
        return;
      }

      if (!/^https:\/\/[^/]+/.test(url)) {
        message("L'URL Supabase doit commencer par https://.");
        return;
      }

      try {
        new URL(url);
        saveConfig(url.replace(/\/+$/, ""), key);
        client = null;
        message("Configuration enregistrée.", true);
      } catch {
        message("L'URL Supabase est invalide.");
      }
    });

    // Connexion
    $("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = $("#email").value.trim();
      const password = $("#password").value;

      if (!email || !password) {
        message("Renseigne ton e-mail et ton mot de passe.");
        return;
      }

      setBusy(true, recoveryMode ? "Mise à jour..." : "Connexion...");

      try {
        const supabase = getClient();

        if (recoveryMode) {
          const { error } = await supabase.auth.updateUser({
            password
          });

          if (error) throw error;

          recoveryMode = false;
          $("#password").value = "";
          $("#password").autocomplete = "current-password";
          $("#loginBtn").textContent = "Se connecter";
          message(
            "Mot de passe modifié. Tu peux maintenant te connecter.",
            true
          );
          return;
        }

        const { data, error } =
          await supabase.auth.signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        if (!data.session) {
          throw new Error("Aucune session active n'a été créée.");
        }

        goToApp();
      } catch (error) {
        console.error(error);
        message(error.message || "Connexion impossible.");
      } finally {
        setBusy(false, recoveryMode ? "Modifier le mot de passe" : "Se connecter");
      }
    });

    // Création du compte personnel
    $("#signupBtn").addEventListener("click", async () => {
      const email = $("#email").value.trim();
      const password = $("#password").value;

      if (!email || !password) {
        message("Renseigne ton e-mail et un mot de passe.");
        return;
      }

      if (password.length < 6) {
        message("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }

      setBusy(true, "Création du compte...");

      try {
        const supabase = getClient();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.href.split("#")[0]
          }
        });

        if (error) throw error;

        if (data.session) {
          goToApp();
        } else {
          message(
            "Demande de création envoyée. Vérifie ta boîte e-mail pour confirmer ton compte.",
            true
          );
        }
      } catch (error) {
        console.error(error);
        message(error.message || "Création du compte impossible.");
      } finally {
        setBusy(false, "Se connecter");
      }
    });

    // Réinitialisation du mot de passe
    $("#resetBtn").addEventListener("click", async () => {
      const email = $("#email").value.trim();

      if (!email) {
        message("Saisis ton adresse e-mail avant de demander un lien.");
        return;
      }

      try {
        const supabase = getClient();
        const redirectTo = new URL(LOGIN_PAGE, window.location.href).href;

        const { error } = await supabase.auth.resetPasswordForEmail(
          email,
          { redirectTo }
        );

        if (error) throw error;

        message(
          "Si cette adresse correspond à un compte, un lien de réinitialisation sera envoyé. Vérifie tes e-mails.",
          true
        );
      } catch (error) {
        console.error(error);
        message(error.message || "Impossible d'envoyer le lien.");
      }
    });

    // Détecter le retour depuis le lien de récupération
    try {
      const supabase = getClient();

      supabase.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          recoveryMode = true;
          $("#password").value = "";
          $("#password").autocomplete = "new-password";
          $("#password").placeholder = "Choisis un nouveau mot de passe";
          $("#loginBtn").textContent = "Modifier le mot de passe";
          message("Saisis ton nouveau mot de passe.");
        }
      });

      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      // Ne pas rediriger si un lien de récupération vient d'être ouvert.
      if (window.location.hash.includes("type=recovery")) {
        recoveryMode = true;
        $("#password").autocomplete = "new-password";
        $("#password").placeholder = "Choisis un nouveau mot de passe";
        $("#loginBtn").textContent = "Modifier le mot de passe";
        message("Saisis ton nouveau mot de passe.");
      } else if (data.session) {
        goToApp();
      }
    } catch (error) {
      console.warn("Session Supabase non disponible :", error.message);
    }
  }

  // --------------------------------------------------
  // PROTECTION DE L'APPLICATION
  // --------------------------------------------------

  async function protectApp() {
    // La page doit rester masquée jusqu'à la vérification.
    document.documentElement.classList.add("tempo-auth-checking");

    try {
      const supabase = getClient();
      const { data, error } = await supabase.auth.getSession();

      if (error) throw error;

      if (!data.session) {
        window.location.replace(LOGIN_PAGE);
        return;
      }

      // Bouton facultatif à ajouter dans index.html.
      const logoutButton = $("#logoutBtn");

      if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
          logoutButton.disabled = true;

          try {
            const { error: logoutError } =
              await supabase.auth.signOut();

            if (logoutError) throw logoutError;

            window.location.replace(LOGIN_PAGE);
          } catch (error) {
            console.error(error);
            alert("Déconnexion impossible. Réessaie.");
            logoutButton.disabled = false;
          }
        });
      }

      // Réagir aussi à une déconnexion depuis un autre onglet.
      supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          window.location.replace(LOGIN_PAGE);
        }
      });

      document.documentElement.classList.remove("tempo-auth-checking");
      document.documentElement.classList.add("tempo-authenticated");
    } catch (error) {
      console.error("Vérification de la session impossible :", error);

      // En cas d'erreur de configuration, ne pas laisser
      // l'application personnelle visible.
      window.location.replace(LOGIN_PAGE);
    }
  }

  if (isLoginPage()) {
    initLoginPage();
  } else {
    protectApp();
  }
})();
