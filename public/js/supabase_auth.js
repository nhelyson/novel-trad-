/**
 * supabase_auth.js - Centralized Supabase Auth Manager (NovelTrad)
 * 
 * - Guest First: Lecture, Catalogue & IndexedDB restent 100% accessibles sans compte.
 * - Authentification Optionnelle : Email + Mot de passe (Confirm email DÉSACTIVÉ).
 * - Inscription directe : session immédiate sans écran de confirmation email.
 * - Espace Compte : Mon profil, Ma bibliothèque, Continuer, Favoris, Historique, Paramètres, Déconnexion.
 * - Sécurisé : Clé publique uniquement, aucun mot de passe stocké localement.
 */

class SupabaseAuthManager {
    constructor() {
        this.client = null;
        this.currentUser = null;
        this.currentSession = null;
        this.userProfile = null; // { id, email, display_name, role: 'USER'|'CONTRIBUTOR'|'ADMIN' }
        this.listeners = [];
        this.authListeners = this.listeners;
        this.initialized = false;
        this._initialAuthProcessed = false;
        this.initPromise = this.init();
    }

    
    async fetchUserProfile(userId) {
        if (!userId) {
            this.userProfile = null;
            return null;
        }
        
        const email = (this.currentUser ? this.currentUser.email : '').toLowerCase();
        let role = 'USER';
        let displayName = this.currentUser ? (this.currentUser.user_metadata?.display_name || this.currentUser.email?.split('@')[0]) : 'Utilisateur';
        let avatarUrl = this.currentUser?.user_metadata?.avatar_url || '';

        // 1. Interroger le serveur NovelTrad (source synchronisée avec les rôles assignés par l'admin)
        let roleFoundInProfiles = false;
        try {
            const token = await this.getAccessToken();
            if (token) {
                const res = await fetch('/api/auth/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.user && data.user.role) {
                        role = data.user.role.toUpperCase();
                        roleFoundInProfiles = true;
                        if (data.user.display_name) displayName = data.user.display_name;
                        if (data.user.avatar_url) avatarUrl = data.user.avatar_url;
                    }
                }
            }
        } catch (apiErr) {
            console.warn('[SupabaseAuth] Erreur fetch /api/auth/profile:', apiErr.message);
        }

        // 2. Si non trouvé via backend, lire depuis la table 'profiles' Supabase
        if (!roleFoundInProfiles && this.client) {
            try {
                const { data: profData } = await this.client
                    .from('profiles')
                    .select('role, display_name, avatar_url')
                    .eq('id', userId)
                    .single();
                if (profData && profData.role) {
                    role = profData.role.toUpperCase();
                    roleFoundInProfiles = true;
                }
                if (profData && profData.display_name) {
                    displayName = profData.display_name;
                }
                if (profData && profData.avatar_url) {
                    avatarUrl = profData.avatar_url;
                }
            } catch (e) {
                console.warn('[SupabaseAuth] Erreur lecture table profiles:', e.message);
            }
        }

        // 2. Metadata Supabase / app_metadata UNIQUEMENT si le profil est introuvable dans la table Supabase
        if (!roleFoundInProfiles) {
            if (this.currentUser?.app_metadata?.role) {
                role = this.currentUser.app_metadata.role.toUpperCase();
            } else if (this.currentUser?.user_metadata?.role) {
                role = this.currentUser.user_metadata.role.toUpperCase();
            }
        }

        // 3. Rôle vérifié : admin officiel exclusivement
        if (email === 'admin@noveltrad.com' || email === 'japhetikoume@gmail.com' || email === 'ikoumejaphet@gmail.com') {
            role = 'ADMIN';
        }

        this.userProfile = {
            id: userId,
            email: this.currentUser ? this.currentUser.email : '',
            display_name: displayName || (this.currentUser && this.currentUser.email ? this.currentUser.email.split('@')[0] : 'Lecteur'),
            avatar_url: avatarUrl || (this.currentUser?.user_metadata?.avatar_url || ''),
            role: role
        };

        this._notifyRoleChange();
        return this.userProfile;
    }

    _notifyRoleChange() {
        this.updateNavbarUI();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('user-role-changed', {
                detail: {
                    role: this.getUserRole(),
                    profile: this.userProfile,
                    user: this.currentUser
                }
            }));
        }
    }

    getUserRole() {
        if (this.userProfile && this.userProfile.role) {
            return this.userProfile.role.toUpperCase();
        }
        if (this.currentUser && this.currentUser.email) {
            const email = this.currentUser.email.toLowerCase();
            if (email === 'admin@noveltrad.com') return 'ADMIN';
            if (this.currentUser.app_metadata?.role) return this.currentUser.app_metadata.role.toUpperCase();
            if (this.currentUser.user_metadata?.role) return this.currentUser.user_metadata.role.toUpperCase();
        }
        return 'USER';
    }

    async getAccessToken() {
        if (this.currentSession && this.currentSession.access_token) {
            return this.currentSession.access_token;
        }
        if (this.initPromise) {
            await this.initPromise;
        }
        if (this.client) {
            try {
                const { data } = await this.client.auth.getSession();
                if (data && data.session) {
                    this.currentSession = data.session;
                    return data.session.access_token;
                }
            } catch (e) {
                console.warn('[SupabaseAuth] Erreur getAccessToken:', e.message);
            }
        }
        return null;
    }

    isContributor() {
        const role = this.getUserRole();
        return role === 'CONTRIBUTOR' || role === 'ADMIN';
    }

    isAdmin() {
        return this.getUserRole() === 'ADMIN';
    }

    getProfile() {
        return this.userProfile;
    }

    async init() {
        try {
            // 1. Récupérer la configuration publique depuis l'API backend
            const res = await fetch('/api/config/supabase');
            const data = await res.json();

            if (!data.success || !data.configured || !data.supabaseUrl || !data.supabasePublishableKey) {
                console.warn('[SupabaseAuth] Configuration Supabase non disponible ou incomplète.');
                return null;
            }

            // 2. Vérifier que la librairie supabase-js est chargée
            if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
                console.warn('[SupabaseAuth] Librairie @supabase/supabase-js non disponible sur window.');
                return null;
            }

            // 3. Initialiser le client unique
            this.client = window.supabase.createClient(data.supabaseUrl, data.supabasePublishableKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage: window.localStorage
                }
            });

            // 4. Récupérer la session existante
            const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
            if (sessionError) {
                console.warn('[SupabaseAuth] Erreur lecture session:', sessionError.message);
            } else if (sessionData && sessionData.session) {
                this.currentSession = sessionData.session;
                this.currentUser = sessionData.session.user;
                await this.fetchUserProfile(this.currentUser.id);
                if (window.libraryDB && typeof window.libraryDB.switchUser === 'function') {
                    await window.libraryDB.switchUser(this.currentUser.id);
                }
                if (typeof initLibrary === 'function') {
                    initLibrary(true);
                }
            }

            // 5. Écouter les changements d'état d'authentification
            this.client.auth.onAuthStateChange(async (event, session) => {
                this.currentSession = session;
                this.currentUser = session ? session.user : null;
                this.userProfile = null; // Réinitialiser impérativement pour éviter toute fuite de rôle entre sessions
                if (typeof window.resetLibraryCache === 'function') {
                    window.resetLibraryCache(); // Vider immédiatement le cache mémoire de la bibliothèque
                }
                if (this.currentUser) {
                    await this.fetchUserProfile(this.currentUser.id);
                }
                // Isolation automatique de la base locale par utilisateur
                if (window.libraryDB && typeof window.libraryDB.switchUser === 'function') {
                    await window.libraryDB.switchUser(this.currentUser ? this.currentUser.id : 'guest');
                    if (typeof initLibrary === 'function') initLibrary(true); // Toujours forcer la mise à jour propre
                }
                this._notifyListeners(event, session);
                this.updateNavbarUI();
                this.renderProfileView();

                if (event === 'SIGNED_IN') {
                    // Migration automatique des livres et favoris de la session invité
                    if (session && session.access_token) {
                        fetch('/api/library/adopt-guest', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${session.access_token}`
                            }
                        }).then(async r => {
                            if (!r.ok) return null;
                            const text = await r.text();
                            try { return JSON.parse(text); } catch (e) { return null; }
                        }).then(data => {
                            if (data && data.adoptedCount > 0) {
                                if (typeof initLibrary === 'function') initLibrary(true);
                            }
                        }).catch(() => {});
                    }
                    /* Toast réservé exclusivement à signIn() manuel */
                } else if (event === 'SIGNED_OUT') {
                    /* Toast géré lors de signOut() */
                }
                this._initialAuthProcessed = true;
            });

            this.updateNavbarUI();
            this.renderProfileView();
            if (window.contributorManager && typeof window.contributorManager.loadMyNovels === 'function') {
                window.contributorManager.loadMyNovels();
            }
            return this.client;

        } catch (err) {
            console.error('[SupabaseAuth] Erreur initialisation:', err.message);
            return null;
        }
    }

    onAuthStateChange(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
            if (this.currentUser) {
                callback('INITIAL', this.currentSession);
            }
        }
    }

    _notifyListeners(event, session) {
        const list = this.listeners || this.authListeners || [];
        list.forEach(cb => {
            try { cb(event, session); } catch (e) { console.error('[Auth Listener Error]', e); }
        });
    }

    isConfigured() {
        return Boolean(this.client);
    }

    isAuthenticated() {
        return Boolean(this.currentUser);
    }

    getUser() {
        return this.currentUser;
    }

    getSession() {
        return this.currentSession;
    }

    getProfileData() {
        if (!this.currentUser) return null;
        const user = this.currentUser;
        
        let createdAt = 'Date non disponible';
        if (user.created_at) {
            try {
                createdAt = new Date(user.created_at).toLocaleDateString('fr-FR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
            } catch (e) {
                createdAt = user.created_at;
            }
        }

        let lastSignIn = 'Session en cours';
        if (user.last_sign_in_at) {
            try {
                lastSignIn = new Date(user.last_sign_in_at).toLocaleDateString('fr-FR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {
                lastSignIn = user.last_sign_in_at;
            }
        }

        return {
            id: user.id,
            email: user.email || 'Utilisateur',
            createdAt: createdAt,
            lastSignIn: lastSignIn,
            status: 'Compte actif',
            role: user.role || 'Lecteur'
        };
    }


    // =========================================================================
    // MISE À JOUR DU PROFIL (PSEUDONYME & AVATAR)
    // =========================================================================
    async updateProfile({ display_name, avatar_url }) {
        await this.initPromise;
        if (!this.currentUser) {
            return { success: false, message: 'Vous devez être connecté pour modifier votre profil.' };
        }

        try {
            const token = await this.getAccessToken();
            if (!token) {
                return { success: false, message: 'Session expirée. Veuillez vous reconnecter.' };
            }

            const payload = {};
            if (display_name !== undefined) payload.display_name = display_name;
            if (avatar_url !== undefined) payload.avatar_url = avatar_url;

            const res = await fetch('/api/auth/profile', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Erreur lors de la mise à jour du profil.');
            }

            // Sync userProfile local state
            if (!this.userProfile) this.userProfile = {};
            if (data.user.display_name) this.userProfile.display_name = data.user.display_name;
            if (data.user.avatar_url !== undefined) this.userProfile.avatar_url = data.user.avatar_url;

            // Update Supabase auth user_metadata if client available
            if (this.client && this.client.auth) {
                try {
                    await this.client.auth.updateUser({
                        data: {
                            display_name: this.userProfile.display_name,
                            avatar_url: this.userProfile.avatar_url
                        }
                    });
                } catch(e) {}
            }

            this.updateNavbarUI();
            this.renderProfileView();
            this.showToast('Profil mis à jour avec succès !');

            return { success: true, user: this.userProfile };
        } catch (err) {
            console.error('[SupabaseAuth UpdateProfile Error]', err);
            return { success: false, message: err.message };
        }
    }

    renderProfileView() {
        const accountModule = document.getElementById('accountModuleContainer');
        if (!accountModule) return;

        const guestView = document.getElementById('accountGuestView');
        const authView = document.getElementById('accountAuthView');
        const data = this.getProfileData();

        if (!data || !this.currentUser) {
            // Mode Visiteur / Invité
            if (guestView) guestView.classList.remove('hidden');
            if (authView) authView.classList.add('hidden');
            return;
        }

        // Mode Connecté
        if (guestView) guestView.classList.add('hidden');
        if (authView) authView.classList.remove('hidden');

        const profile = this.userProfile || {};
        const pseudo = profile.display_name || (this.currentUser.user_metadata?.display_name) || (this.currentUser.email ? this.currentUser.email.split('@')[0] : 'Lecteur');
        const avatar = profile.avatar_url || (this.currentUser.user_metadata?.avatar_url) || '';

        // Header info
        const displayNameTitle = document.getElementById('accountDisplayNameTitle');
        const emailEl = document.getElementById('accountUserEmail');
        const pEmailEl = document.getElementById('accountProfileEmail');
        const pCreatedEl = document.getElementById('accountProfileCreatedAt');
        const pLastEl = document.getElementById('accountProfileLastSignIn');
        const pStatusEl = document.getElementById('accountProfileStatus');
        const avatarPreview = document.getElementById('accountAvatarPreview');

        if (displayNameTitle) displayNameTitle.textContent = pseudo;
        if (emailEl) emailEl.textContent = data.email;
        if (pEmailEl) pEmailEl.textContent = data.email;
        if (pCreatedEl) pCreatedEl.textContent = data.createdAt;
        if (pLastEl) pLastEl.textContent = data.lastSignIn;
        if (pStatusEl) pStatusEl.textContent = data.status;

        // Avatar Preview
        if (avatarPreview) {
            if (avatar) {
                avatarPreview.innerHTML = `<img src="${avatar}" alt="${pseudo}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user\\'></i>'">`;
            } else {
                avatarPreview.innerHTML = '<i class="fa-solid fa-user"></i>';
            }
        }

        // Form Inputs
        const inputPseudo = document.getElementById('accountInputPseudo');
        const inputAvatarUrl = document.getElementById('accountInputAvatarUrl');
        if (inputPseudo && document.activeElement !== inputPseudo) {
            inputPseudo.value = pseudo;
        }
        if (inputAvatarUrl && document.activeElement !== inputAvatarUrl) {
            inputAvatarUrl.value = avatar;
        }

        // Highlight active preset avatar if matches
        document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
            const presetUrl = btn.getAttribute('data-avatar-url');
            if (presetUrl && presetUrl === avatar) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Role indicator & quick access in account tab
        const role = this.getUserRole();
        const roleBadgeEl = document.getElementById('accountUserRoleBadge');
        if (roleBadgeEl) {
            roleBadgeEl.textContent = role === 'ADMIN' ? 'Administrateur' : (role === 'CONTRIBUTOR' ? 'Contributeur' : 'Lecteur');
            roleBadgeEl.className = 'role-badge role-' + role.toLowerCase();
        }

        const adminShortcut = document.getElementById('accountShortcutAdmin');
        const contribShortcut = document.getElementById('accountShortcutContrib');
        if (adminShortcut) {
            if (this.isAdmin()) adminShortcut.classList.remove('hidden');
            else adminShortcut.classList.add('hidden');
        }
        if (contribShortcut) {
            if (this.isContributor()) contribShortcut.classList.remove('hidden');
            else contribShortcut.classList.add('hidden');
        }
    }

    // =========================================================================
    // INSCRIPTION DIRECTE (EMAIL + MOT DE PASSE — CONFIRM EMAIL DÉSACTIVÉ)
    // =========================================================================
    async signUp(email, password, confirmPassword) {
        await this.initPromise;
        if (!this.client) {
            return { success: false, message: 'Le service d\'authentification n\'est pas encore configuré.' };
        }

        // Validations frontend
        const cleanEmail = (email || '').trim().toLowerCase();
        if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
            return { success: false, message: 'Veuillez saisir une adresse email valide.' };
        }
        if (!password || password.length < 6) {
            return { success: false, message: 'Le mot de passe doit contenir au moins 6 caractères.' };
        }
        if (password !== confirmPassword) {
            return { success: false, message: 'Les mots de passe ne correspondent pas.' };
        }

        try {
            const redirectTo = `${window.location.origin}/index.html`;
            const { data, error } = await this.client.auth.signUp({
                email: cleanEmail,
                password: password,
                options: {
                    emailRedirectTo: redirectTo
                }
            });

            if (error) {
                return { success: false, message: this._translateError(error) };
            }

            // Confirm Email est désactivé -> Session disponible immédiatement
            if (data.session) {
                this.currentSession = data.session;
                this.currentUser = data.session.user || data.user;
            } else if (data.user) {
                this.currentUser = data.user;
            }

            if (this.currentUser) {
                await this.fetchUserProfile(this.currentUser.id);
            }

            this.updateNavbarUI();
            this.renderProfileView();

            return {
                success: true,
                user: this.currentUser,
                session: this.currentSession,
                needEmailConfirm: false,
                message: 'Compte créé et connecté avec succès !'
            };

        } catch (err) {
            console.error('[SupabaseAuth SignUp Error]', err);
            return {
                success: false,
                message: 'Impossible de contacter le service d\'authentification. Vérifiez votre connexion et réessayez.'
            };
        }
    }

    // =========================================================================
    // CONNEXION (EMAIL + MOT DE PASSE)
    // =========================================================================
    async signIn(email, password) {
        await this.initPromise;
        if (!this.client) {
            return { success: false, message: 'Le service d\'authentification n\'est pas encore configuré.' };
        }

        const cleanEmail = (email || '').trim().toLowerCase();
        if (!cleanEmail || !password) {
            return { success: false, message: 'Veuillez renseigner votre email et votre mot de passe.' };
        }

        try {
            const { data, error } = await this.client.auth.signInWithPassword({
                email: cleanEmail,
                password: password
            });

            if (error) {
                return { success: false, message: this._translateError(error) };
            }

            this.currentUser = data.user;
            this.currentSession = data.session;
            this.userProfile = null;
            if (typeof window.resetLibraryCache === 'function') {
                window.resetLibraryCache();
            }
            if (data.user) {
                await this.fetchUserProfile(data.user.id);
            }
            if (typeof initLibrary === 'function') {
                initLibrary(true);
            }
            this.updateNavbarUI();
            this.renderProfileView();

            this.showToast('Connexion réussie !');
            return {
                success: true,
                user: data.user,
                session: data.session,
                message: 'Connexion réussie !'
            };

        } catch (err) {
            console.error('[SupabaseAuth SignIn Error]', err);
            return {
                success: false,
                message: 'Impossible de contacter le service d\'authentification. Vérifiez votre connexion et réessayez.'
            };
        }
    }

    // =========================================================================
    // DÉCONNEXION (IndexedDB STRICTEMENT PRÉSERVÉE)
    // =========================================================================
    async signOut() {
        await this.initPromise;
        if (!this.client) return { success: true };

        try {
            await this.client.auth.signOut();
            this.currentUser = null;
            this.currentSession = null;
            this.userProfile = null; // Réinitialisation stricte du profil
            if (typeof window.resetLibraryCache === 'function') {
                window.resetLibraryCache(); // Vider la bibliothèque en mémoire vive
            }
            this.updateNavbarUI();
            this.renderProfileView();
            if (window.libraryDB && typeof window.libraryDB.switchUser === 'function') {
                await window.libraryDB.switchUser('guest');
                if (typeof initLibrary === 'function') initLibrary(true);
            }

            // Si on est actuellement sur l'onglet Compte, basculer proprement sur l'accueil
            const accountModule = document.getElementById('accountModuleContainer');
            if (accountModule && !accountModule.classList.contains('hidden')) {
                const tabHomeBtn = document.getElementById('tabHomeBtn');
                if (tabHomeBtn) tabHomeBtn.click();
            }

            this.showToast('Déconnexion effectuée.');
            return { success: true };
        } catch (err) {
            console.error('[SupabaseAuth SignOut Error]', err);
            return { success: false, message: this._translateError(err) };
        }
    }

    // =========================================================================
    // TRADUCTION DES ERREURS SUPABASE EN MESSAGES UTILISATEUR PROPRES
    // =========================================================================
    _translateError(error) {
        if (!error) return 'Une erreur est survenue.';
        const msg = (error.message || '').toLowerCase();

        if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) {
            return 'Adresse email ou mot de passe incorrect.';
        }
        if (msg.includes('user already registered') || msg.includes('already registered')) {
            return 'Cette adresse email est déjà enregistrée. Veuillez vous connecter.';
        }
        if (msg.includes('password should be at least')) {
            return 'Le mot de passe doit comporter au moins 6 caractères.';
        }
        if (msg.includes('rate limit') || msg.includes('too many requests')) {
            return 'Trop de tentatives consécutives. Veuillez patienter un instant avant de réessayer.';
        }
        if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
            return 'Impossible de contacter le service d\'authentification. Vérifiez votre connexion et réessayez.';
        }

        return error.message || 'Une erreur est survenue lors de l\'authentification.';
    }

    // =========================================================================
    // MISE À JOUR DE LA NAVBAR & DE L'INTERFACE UTILISATEUR
    // =========================================================================
    updateNavbarUI() {
        const loginBtn = document.getElementById('navLoginBtn');
        const userMenu = document.getElementById('navUserMenu');
        const userEmailSpan = document.getElementById('navUserEmail');
        const dropdownEmail = document.getElementById('dropdownUserEmail');
        const btnNavContributor = document.getElementById('btnNavContributorStudio');
        const btnNavAdmin = document.getElementById('btnNavAdminPanel');

        if (this.currentUser) {
            if (loginBtn) {
                loginBtn.classList.add('hidden');
                loginBtn.style.setProperty('display', 'none', 'important');
            }
            if (userMenu) {
                userMenu.classList.remove('hidden');
                userMenu.style.setProperty('display', 'inline-flex', 'important');
                
                const profile = this.userProfile || {};
                const displayPseudo = profile.display_name || (this.currentUser.user_metadata?.display_name) || (this.currentUser.email ? this.currentUser.email.split('@')[0] : 'Lecteur');
                const avatar = profile.avatar_url || (this.currentUser.user_metadata?.avatar_url) || '';

                if (userEmailSpan) userEmailSpan.textContent = displayPseudo;
                if (dropdownEmail) {
                    dropdownEmail.innerHTML = `<span class="dropdown-display-name">${displayPseudo}</span><small class="dropdown-email-sub">${this.currentUser.email || ''}</small>`;
                }

                const navAvatarEl = document.getElementById('navUserAvatar');
                if (navAvatarEl) {
                    if (avatar) {
                        navAvatarEl.innerHTML = `<img src="${avatar}" alt="${displayPseudo}" class="nav-avatar-img" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user-check\\'></i>'">`;
                    } else {
                        navAvatarEl.innerHTML = '<i class="fa-solid fa-user-check"></i>';
                    }
                }
            }

            // Role-based visibility (Verrouillé avec display strict)
            const isContrib = this.isContributor();
            const isAdmin = this.isAdmin();

            if (btnNavContributor) {
                if (isContrib) {
                    btnNavContributor.classList.remove('hidden');
                    btnNavContributor.style.setProperty('display', 'flex', 'important');
                } else {
                    btnNavContributor.classList.add('hidden');
                    btnNavContributor.style.setProperty('display', 'none', 'important');
                }
            }

            if (btnNavAdmin) {
                if (isAdmin) {
                    btnNavAdmin.classList.remove('hidden');
                    btnNavAdmin.style.setProperty('display', 'flex', 'important');
                } else {
                    btnNavAdmin.classList.add('hidden');
                    btnNavAdmin.style.setProperty('display', 'none', 'important');
                }
            }
        } else {
            if (loginBtn) {
                loginBtn.classList.remove('hidden');
                loginBtn.style.removeProperty('display');
            }
            if (userMenu) {
                userMenu.classList.add('hidden');
                userMenu.style.setProperty('display', 'none', 'important');
            }
            if (btnNavContributor) {
                btnNavContributor.classList.add('hidden');
                btnNavContributor.style.setProperty('display', 'none', 'important');
            }
            if (btnNavAdmin) {
                btnNavAdmin.classList.add('hidden');
                btnNavAdmin.style.setProperty('display', 'none', 'important');
            }
        }
    }

    showToast(msg) {
        const toast = document.getElementById('catalogToast') || document.getElementById('seriesToast');
        if (!toast) return;
        toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${msg}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
}

// Instance globale unique
window.authManager = new SupabaseAuthManager();
window.supabaseAuthManager = window.authManager;
window.supabaseAuth = window.authManager; // Alias requis pour sync_engine.js

// Initialisation des modales Auth et de l'espace compte au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    initAuthModal();
    initAccountModule();
});

function initAuthModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;

    const navLoginBtn = document.getElementById('navLoginBtn');
    const closeBtn = document.getElementById('authModalClose');
    const tabLogin = document.getElementById('authTabLogin');
    const tabRegister = document.getElementById('authTabRegister');
    const formLogin = document.getElementById('authLoginForm');
    const formRegister = document.getElementById('authRegisterForm');
    const switchRegister = document.getElementById('switchRegisterLink');
    const switchLogin = document.getElementById('switchLoginLink');
    const authFeedback = document.getElementById('authFeedback');

    const navUserPill = document.getElementById('navUserPill');
    const navUserDropdown = document.getElementById('navUserDropdown');
    const btnNavSignOut = document.getElementById('btnNavSignOut');
    const btnNavOpenAccount = document.getElementById('btnNavOpenAccount');
    const btnNavLibrary = document.getElementById('btnNavLibrary');
    const btnNavContinue = document.getElementById('btnNavContinue');
    const btnNavFavorites = document.getElementById('btnNavFavorites');
    const btnNavHistory = document.getElementById('btnNavHistory');
    const btnNavSettings = document.getElementById('btnNavSettings');

    // Toggle Dropdown profil
    if (navUserPill && navUserDropdown) {
        navUserPill.addEventListener('click', (e) => {
            e.stopPropagation();
            navUserDropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!navUserPill.contains(e.target) && !navUserDropdown.contains(e.target)) {
                navUserDropdown.classList.add('hidden');
            }
        });
    }

    // Dropdown links
    const btnNavContributorStudio = document.getElementById('btnNavContributorStudio');
    const btnNavAdminPanel = document.getElementById('btnNavAdminPanel');

    const isIndexPage = () => {
        const p = window.location.pathname;
        return p === '/' || p.endsWith('/index.html') || p.endsWith('/');
    };

    if (btnNavContributorStudio) {
        btnNavContributorStudio.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            if (isIndexPage()) {
                window.location.hash = '#contributor';
                if (window.openContributorTab) window.openContributorTab();
            } else {
                window.location.href = '/index.html#contributor';
            }
        });
    }

    if (btnNavAdminPanel) {
        btnNavAdminPanel.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            if (isIndexPage()) {
                window.location.hash = '#admin';
                if (window.openAdminTab) window.openAdminTab();
            } else {
                window.location.href = '/index.html#admin';
            }
        });
    }

    if (btnNavOpenAccount) {
        btnNavOpenAccount.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            if (isIndexPage()) {
                window.location.hash = '#account';
                if (window.openAccountTab) window.openAccountTab();
            } else {
                window.location.href = '/index.html#account';
            }
        });
    }

    if (btnNavLibrary) {
        btnNavLibrary.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            const tabLib = document.getElementById('tabLibraryBtn');
            if (tabLib) tabLib.click();
        });
    }

    if (btnNavContinue) {
        btnNavContinue.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            const tabCont = document.getElementById('tabContinueBtn');
            if (tabCont) tabCont.click();
        });
    }

    if (btnNavFavorites) {
        btnNavFavorites.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            const tabFav = document.getElementById('tabFavoritesBtn');
            if (tabFav) tabFav.click();
        });
    }

    if (btnNavHistory) {
        btnNavHistory.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            const hBtn = document.getElementById('historyBtn');
            if (hBtn) hBtn.click();
        });
    }

    if (btnNavSettings) {
        btnNavSettings.addEventListener('click', () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            if (isIndexPage()) {
                window.location.hash = '#account';
                if (window.openAccountTab) window.openAccountTab();
                setTimeout(() => {
                    const settingsCard = document.querySelector('.account-card.settings-card');
                    if (settingsCard) settingsCard.scrollIntoView({ behavior: 'smooth' });
                }, 100);
            } else {
                window.location.href = '/index.html#account';
            }
        });
    }

    // Déconnexion
    if (btnNavSignOut) {
        btnNavSignOut.addEventListener('click', async () => {
            if (navUserDropdown) navUserDropdown.classList.add('hidden');
            await window.authManager.signOut();
        });
    }

    // Ouvrir la modale
    if (navLoginBtn) {
        navLoginBtn.addEventListener('click', () => {
            openAuthModal('login');
        });
    }

    // Fermer la modale
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    // Basculer entre onglets
    function showTab(mode) {
        clearFeedback();
        if (mode === 'register') {
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            formRegister.classList.remove('hidden');
            formLogin.classList.add('hidden');
        } else {
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            formLogin.classList.remove('hidden');
            formRegister.classList.add('hidden');
        }
    }

    if (tabLogin) tabLogin.onclick = () => showTab('login');
    if (tabRegister) tabRegister.onclick = () => showTab('register');
    if (switchRegister) switchRegister.onclick = (e) => { e.preventDefault(); showTab('register'); };
    if (switchLogin) switchLogin.onclick = (e) => { e.preventDefault(); showTab('login'); };

    window.openAuthModal = function(mode = 'login') {
        showTab(mode);
        modal.classList.remove('hidden');
    };

    function showFeedback(msg, type = 'error') {
        if (!authFeedback) return;
        authFeedback.textContent = msg;
        authFeedback.className = `auth-feedback ${type}`;
        authFeedback.classList.remove('hidden');
    }

    function clearFeedback() {
        if (!authFeedback) return;
        authFeedback.textContent = '';
        authFeedback.className = 'auth-feedback hidden';
    }

    // Formulaire de Connexion
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFeedback();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const submitBtn = document.getElementById('btnLoginSubmit');

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Connexion...';

            const result = await window.authManager.signIn(email, password);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Se connecter';

            if (result.success) {
                modal.classList.add('hidden');
                formLogin.reset();
                if (window.openAccountTab) window.openAccountTab();
            } else {
                showFeedback(result.message, 'error');
            }
        });
    }

    // Formulaire d'Inscription (Confirm Email désactivé -> connexion directe)
    if (formRegister) {
        formRegister.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFeedback();
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;
            const confirm = document.getElementById('regConfirmPassword').value;
            const submitBtn = document.getElementById('btnRegisterSubmit');

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Création...';

            const result = await window.authManager.signUp(email, password, confirm);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Créer mon compte';

            if (result.success) {
                modal.classList.add('hidden');
                formRegister.reset();
                if (window.openAccountTab) window.openAccountTab();
            } else {
                showFeedback(result.message, 'error');
            }
        });
    }
}

function initAccountModule() {
    // Boutons d'authentification pour invités
    const btnAccountOpenAuth = document.getElementById('btnAccountOpenAuth');
    const btnAccountOpenRegister = document.getElementById('btnAccountOpenRegister');
    if (btnAccountOpenAuth) {
        btnAccountOpenAuth.addEventListener('click', () => {
            if (window.openAuthModal) window.openAuthModal('login');
        });
    }
    if (btnAccountOpenRegister) {
        btnAccountOpenRegister.addEventListener('click', () => {
            if (window.openAuthModal) window.openAuthModal('register');
        });
    }

    // Bouton de déconnexion dans la carte Profil
    const btnAccountSignOut = document.getElementById('btnAccountSignOut');
    if (btnAccountSignOut) {
        btnAccountSignOut.addEventListener('click', async () => {
            if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
                await window.authManager.signOut();
            }
        });
    }

    // Sauvegarde du Pseudonyme
    const btnSavePseudo = document.getElementById('btnSavePseudo');
    const inputPseudo = document.getElementById('accountInputPseudo');
    if (btnSavePseudo && inputPseudo) {
        btnSavePseudo.addEventListener('click', async () => {
            const pseudoVal = inputPseudo.value.trim();
            if (pseudoVal.length < 2) {
                alert('Le pseudonyme doit comporter au moins 2 caractères.');
                return;
            }
            btnSavePseudo.disabled = true;
            btnSavePseudo.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enregistrement...';
            
            const res = await window.authManager.updateProfile({ display_name: pseudoVal });
            btnSavePseudo.disabled = false;
            btnSavePseudo.innerHTML = '<i class="fa-solid fa-check"></i> Enregistrer le pseudo';
            
            if (!res.success) {
                alert(res.message || 'Erreur lors de la mise à jour');
            }
        });
    }

    // Sélecteur d'Avatar Prédéfini
    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const avatarUrl = btn.getAttribute('data-avatar-url');
            if (!avatarUrl) return;

            // Highlight immediately
            document.querySelectorAll('.avatar-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const inputAvatarUrl = document.getElementById('accountInputAvatarUrl');
            if (inputAvatarUrl) inputAvatarUrl.value = avatarUrl;

            // Update avatar
            await window.authManager.updateProfile({ avatar_url: avatarUrl });
        });
    });

    // Sauvegarde de l'Avatar Personnalisé (URL)
    const btnSaveAvatar = document.getElementById('btnSaveAvatar');
    const inputAvatarUrl = document.getElementById('accountInputAvatarUrl');
    if (btnSaveAvatar && inputAvatarUrl) {
        btnSaveAvatar.addEventListener('click', async () => {
            const urlVal = inputAvatarUrl.value.trim();
            btnSaveAvatar.disabled = true;
            btnSaveAvatar.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enregistrement...';
            
            const res = await window.authManager.updateProfile({ avatar_url: urlVal });
            btnSaveAvatar.disabled = false;
            btnSaveAvatar.innerHTML = '<i class="fa-solid fa-check"></i> Appliquer l\'avatar';
            
            if (!res.success) {
                alert(res.message || 'Erreur lors de la mise à jour de l\'avatar');
            }
        });
    }

    // Raccourcis de lecture locaux (IndexedDB)
    const shortcutLib = document.getElementById('accountShortcutLibrary');
    const shortcutCont = document.getElementById('accountShortcutContinue');
    const shortcutFav = document.getElementById('accountShortcutFavorites');
    const shortcutHist = document.getElementById('accountShortcutHistory');

    if (shortcutLib) {
        shortcutLib.addEventListener('click', () => {
            const btn = document.getElementById('tabLibraryBtn');
            if (btn) btn.click();
        });
    }

    if (shortcutCont) {
        shortcutCont.addEventListener('click', () => {
            const btn = document.getElementById('tabContinueBtn');
            if (btn) btn.click();
        });
    }

    if (shortcutFav) {
        shortcutFav.addEventListener('click', () => {
            const btn = document.getElementById('tabFavoritesBtn');
            if (btn) btn.click();
        });
    }

    if (shortcutHist) {
        shortcutHist.addEventListener('click', () => {
            const btn = document.getElementById('historyBtn');
            if (btn) btn.click();
        });
    }

    // Paramètres locaux simples (Lecteur)
    const selTheme = document.getElementById('accountSettingTheme');
    const selFontSize = document.getElementById('accountSettingFontSize');
    const selFontFamily = document.getElementById('accountSettingFontFamily');
    const selLineHeight = document.getElementById('accountSettingLineHeight');

    // Charger les préférences existantes depuis localStorage
    try {
        const savedTheme = localStorage.getItem('noveltrad_reader_theme');
        if (savedTheme && selTheme) selTheme.value = savedTheme;

        const savedSize = localStorage.getItem('noveltrad_reader_fontsize');
        if (savedSize && selFontSize) selFontSize.value = savedSize;

        const savedFont = localStorage.getItem('noveltrad_reader_font');
        if (savedFont && selFontFamily) selFontFamily.value = savedFont;

        const savedLH = localStorage.getItem('noveltrad_reader_lineheight');
        if (savedLH && selLineHeight) selLineHeight.value = savedLH;
    } catch (e) {
        console.warn('[Account Settings] Error reading saved preferences:', e);
    }

    // Enregistrer les préférences
    if (selTheme) {
        selTheme.addEventListener('change', (e) => {
            const chosen = e.target.value;
            localStorage.setItem('noveltrad_reader_theme', chosen);
            if (window.setNovelTradTheme) {
                window.setNovelTradTheme(chosen, true);
            } else if (window.authManager) {
                window.authManager.showToast('Thème mis à jour.');
            }
        });
    }

    if (selFontSize) {
        selFontSize.addEventListener('change', (e) => {
            localStorage.setItem('noveltrad_reader_fontsize', e.target.value);
            if (window.authManager) window.authManager.showToast('Taille de police mise à jour.');
        });
    }

    if (selFontFamily) {
        selFontFamily.addEventListener('change', (e) => {
            localStorage.setItem('noveltrad_reader_font', e.target.value);
            if (window.authManager) window.authManager.showToast('Police du lecteur mise à jour.');
        });
    }

    if (selLineHeight) {
        selLineHeight.addEventListener('change', (e) => {
            localStorage.setItem('noveltrad_reader_lineheight', e.target.value);
            if (window.authManager) window.authManager.showToast('Interligne mis à jour.');
        });
    }
}


// Synchronisation immédiate de la Navbar lors de tout changement de rôle
if (typeof window !== 'undefined') {
  window.addEventListener('user-role-changed', () => {
    if (window.authManager && typeof window.authManager.updateNavbarUI === 'function') {
      window.authManager.updateNavbarUI();
    }
  });
}
