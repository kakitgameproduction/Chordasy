(function () {
const API_BASE =
  window.CHORDASY_PROMO_API_BASE ||
  "https://chordasy-promo.kakitgameproduction.workers.dev/api/promo";

  function setMessage(element, text, tone) {
    if (!element) return;
    element.textContent = text || "";
    if (tone) {
      element.dataset.tone = tone;
    } else {
      delete element.dataset.tone;
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function renderGroupOptions(select, groups, placeholder) {
    if (!select) return;
    select.innerHTML = "";
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);
    groups.forEach((group) => {
      const option = document.createElement("option");
      option.value = String(group.id);
      option.textContent = `${group.name} (${group.available_count} available)`;
      select.appendChild(option);
    });
  }

  function authHeader(auth) {
    return auth ? { Authorization: `Basic ${auth}` } : {};
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function platformName(platform) {
    return platform === "ios" ? "App Store" : "Google Play";
  }

  async function initRedeemPage() {
    const form = document.getElementById("redeem-form");
    if (!form) return;
    const inviteCode = document.getElementById("invite-code");
    const platform = document.getElementById("redeem-platform");
    const email = document.getElementById("email");
    const emailRow = document.getElementById("redeem-email-row");
    const statusButton = document.getElementById("check-invite");
    const submitButton = document.getElementById("redeem-submit");
    const statusMessage = document.getElementById("redeem-status");
    const successCard = document.getElementById("redeem-success");
    const codeValue = document.getElementById("claimed-code");
    const codeMeta = document.getElementById("claimed-meta");
    const storeLink = document.getElementById("store-redeem-link");
    const storeHelp = document.getElementById("store-redeem-help");
    const groupLabel = document.getElementById("group-status-value");
    const remainingLabel = document.getElementById("remaining-status-value");
    let inviteVerified = false, generation = 0;

    function setInviteAccepted(accepted) {
      inviteVerified = accepted;
      emailRow.classList.toggle("promo-hidden", !accepted);
      submitButton.classList.toggle("promo-hidden", !accepted);
      statusButton.classList.toggle("promo-hidden", accepted);
      email.disabled = !accepted;
      email.required = accepted;
    }
    function resetInvite() {
      generation++;
      setInviteAccepted(false);
      statusButton.disabled = false;
      groupLabel.textContent = "Not verified";
      remainingLabel.textContent = "0";
      successCard.hidden = true;
      storeLink.removeAttribute("href");
      setMessage(statusMessage, "Choose your platform and check your invite code.", "muted");
    }
    resetInvite();
    async function checkInvite() {
      const value = inviteCode.value.trim(), selected = platform.value;
      if (!value || !selected) {
        setMessage(statusMessage, "Choose your platform and enter your invite code.", "muted");
        return;
      }
      const requestGeneration = ++generation;
      statusButton.disabled = true;
      setMessage(statusMessage, "Checking invite code...", "muted");
      try {
        const data = await apiFetch("/redeem/status", {
          method: "POST", body: JSON.stringify({ inviteCode: value, platform: selected }),
        });
        if (requestGeneration !== generation) return;
        if ((data.platform || "android") !== selected) throw new Error("This store is not enabled yet. Please try again later.");
        groupLabel.textContent = data.group.name;
        remainingLabel.textContent = String(data.group.availableCount);
        setInviteAccepted(true);
        email.focus();
        setMessage(statusMessage, data.group.availableCount > 0
          ? `${platformName(selected)} invite accepted. Enter your email to claim your code.`
          : `No new ${platformName(selected)} codes remain. You can still look up a code already issued to your email.`,
          data.group.availableCount > 0 ? "success" : "muted");
      } catch (error) {
        if (requestGeneration !== generation) return;
        resetInvite();
        setMessage(statusMessage, error.message, "error");
      } finally {
        if (requestGeneration === generation) statusButton.disabled = false;
      }
    }
    statusButton.addEventListener("click", checkInvite);
    inviteCode.addEventListener("input", resetInvite);
    platform.addEventListener("change", () => { resetInvite(); if (inviteCode.value.trim()) checkInvite(); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!inviteVerified) { await checkInvite(); return; }
      const inviteValue = inviteCode.value.trim(), emailValue = email.value.trim().toLowerCase(), selected = platform.value;
      if (!isValidEmail(emailValue)) { setMessage(statusMessage, "Enter a valid email address.", "error"); return; }
      successCard.hidden = true;
      submitButton.disabled = true;
      platform.disabled = inviteCode.disabled = email.disabled = true;
      setMessage(statusMessage, `Issuing your ${platformName(selected)} code...`, "muted");
      try {
        const data = await apiFetch("/redeem/claim", {
          method: "POST", body: JSON.stringify({ inviteCode: inviteValue, email: emailValue, platform: selected }),
        });
        if ((data.platform || "android") !== selected) throw new Error("The store response did not match your platform. Contact the organiser.");
        groupLabel.textContent = data.group.name;
        remainingLabel.textContent = String(data.group.availableCount);
        codeValue.textContent = data.code;
        codeMeta.textContent = data.reusedClaim
          ? `Your previously issued ${platformName(selected)} code for ${data.group.name}.`
          : `${platformName(selected)} code issued for ${emailValue}. Remaining: ${data.group.availableCount}.`;
        if (data.expiresAt) codeMeta.textContent += ` Expires: ${new Date(data.expiresAt).toLocaleString()}.`;
        // Build a store-owned URL locally; never follow arbitrary API redirect URLs.
        const link = new URL(selected === "ios" ? "https://apps.apple.com/redeem" : "https://play.google.com/redeem");
        if (selected === "ios") { link.searchParams.set("ctx", "offercodes"); link.searchParams.set("id", "6791454575"); }
        link.searchParams.set("code", data.code);
        storeLink.href = link.href;
        storeLink.textContent = `Redeem in ${platformName(selected)}`;
        storeHelp.textContent = selected === "ios"
          ? "Open this link on your iPhone or iPad and complete redemption in the App Store. Then open Chordasy. If Full Version has not appeared, use Restore Purchase with the same Apple Account."
          : "Complete redemption in Google Play using the Google Account you use for Chordasy, then reopen the app.";
        successCard.hidden = false;
        setMessage(statusMessage, "Your code is ready. Complete redemption in the store.", "success");
      } catch (error) {
        setMessage(statusMessage, error.message, "error");
      } finally {
        submitButton.disabled = false;
        platform.disabled = inviteCode.disabled = false;
        email.disabled = !inviteVerified;
      }
    });
  }

  async function initAdminPage() {
    const loginForm = document.getElementById("admin-login-form");
    if (!loginForm) return;

    const loginSection = document.getElementById("admin-login-section");
    const appSection = document.getElementById("admin-app");
    const loginMessage = document.getElementById("admin-login-message");
    const usernameInput = document.getElementById("admin-username");
    const passwordInput = document.getElementById("admin-password");
    const createGroupForm = document.getElementById("create-group-form");
    const importForm = document.getElementById("import-codes-form");
    const blacklistForm = document.getElementById("blacklist-form");
    const codesExplorerForm = document.getElementById("codes-explorer-form");
    const claimsFilterForm = document.getElementById("claims-filter-form");
    const logoutButton = document.getElementById("admin-logout");
    const refreshButton = document.getElementById("admin-refresh");
    const fileInput = document.getElementById("codes-file");

    const summaryNodes = {
      groups: document.getElementById("summary-groups"),
      available: document.getElementById("summary-available"),
      claimed: document.getElementById("summary-claimed"),
      blacklist: document.getElementById("summary-blacklist"),
    };

    const groupsTableBody = document.getElementById("groups-table-body");
    const codesTableBody = document.getElementById("codes-table-body");
    const claimsTableBody = document.getElementById("claims-table-body");
    const blacklistTableBody = document.getElementById("blacklist-table-body");

    const createGroupMessage = document.getElementById("create-group-message");
    const importMessage = document.getElementById("import-message");
    const blacklistMessage = document.getElementById("blacklist-message");
    const codesMessage = document.getElementById("codes-message");
    const claimsMessage = document.getElementById("claims-message");

    const groupSelectNodes = [
      document.getElementById("import-group-id"),
      document.getElementById("codes-group-id"),
      document.getElementById("claims-group-id"),
    ];

    let adminAuth = sessionStorage.getItem("promo_admin_auth") || "";
    let cachedGroups = [];

    function clearAdminLoginFields() {
      if (usernameInput) {
        usernameInput.value = "";
      }
      if (passwordInput) {
        passwordInput.value = "";
      }
      loginForm.reset();
    }

    function setLoggedIn(isLoggedIn) {
      loginSection.classList.toggle("promo-hidden", isLoggedIn);
      appSection.classList.toggle("promo-hidden", !isLoggedIn);
      if (!isLoggedIn) {
        clearAdminLoginFields();
      }
    }

    function groupOptionPlaceholder(select) {
      if (select && select.id === "claims-group-id") {
        return "All groups";
      }
      return "Select group";
    }

    async function adminFetch(path, options = {}) {
      return apiFetch(path, {
        ...options,
        headers: {
          ...authHeader(adminAuth),
          ...(options.headers || {}),
        },
      });
    }

    function fillSummary(summary) {
      summaryNodes.groups.textContent = String(summary.totalGroups);
      summaryNodes.available.textContent = String(summary.availableCodes);
      summaryNodes.claimed.textContent = String(summary.claimedCodes);
      summaryNodes.blacklist.textContent = String(summary.blacklistedEmails);
    }

    function renderGroups(groups) {
      cachedGroups = groups;
      groupSelectNodes.forEach((node) => renderGroupOptions(node, groups, groupOptionPlaceholder(node)));
      groupsTableBody.innerHTML = "";
      groups.forEach((group) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>
            <strong>${escapeHtml(group.name)}</strong><br>
            <span class="promo-field-hint">${escapeHtml(group.slug)}</span>
          </td>
          <td><span class="promo-tag ${group.is_active ? "promo-tag-active" : "promo-tag-inactive"}">${group.is_active ? "Active" : "Disabled"}</span></td>
          <td>${Number(group.available_count || 0)}<br><span class="promo-field-hint">Android: ${Number(group.android_available || 0)} · iOS: ${Number(group.ios_available || 0)}</span></td>
          <td>${group.claimed_count}</td>
          <td>${group.total_count}</td>
          <td>${escapeHtml(group.last_imported_at || "-")}</td>
          <td>
            <div class="promo-group-invite-editor">
              <input
                class="promo-group-invite-input"
                type="text"
                placeholder="new invite code"
                data-group-invite-input="${group.id}"
                aria-label="New invite code for ${escapeHtml(group.name)}"
              />
              <div class="promo-toolbar">
                <button class="promo-button promo-button-secondary" data-group-invite-save="${group.id}" data-group-name="${escapeHtml(group.name)}">Save Invite</button>
                <button class="promo-button promo-button-secondary" data-group-toggle="${group.id}" data-active="${group.is_active ? "1" : "0"}">${group.is_active ? "Disable" : "Enable"}</button>
              </div>
              <span class="promo-field-hint promo-group-invite-note" data-group-invite-note="${group.id}"></span>
            </div>
          </td>
        `;
        groupsTableBody.appendChild(row);
      });

      groupsTableBody.querySelectorAll("[data-group-toggle]").forEach((button) => {
        button.addEventListener("click", async () => {
          const groupId = button.getAttribute("data-group-toggle");
          const nextActive = button.getAttribute("data-active") !== "1";
          button.disabled = true;
          try {
            await adminFetch(`/admin/groups/${groupId}`, {
              method: "PATCH",
              body: JSON.stringify({ isActive: nextActive }),
            });
            await refreshDashboard();
          } catch (error) {
            setMessage(createGroupMessage, error.message, "error");
          } finally {
            button.disabled = false;
          }
        });
      });

      groupsTableBody.querySelectorAll("[data-group-invite-save]").forEach((button) => {
        button.addEventListener("click", async () => {
          const groupId = button.getAttribute("data-group-invite-save");
          const groupName = button.getAttribute("data-group-name") || "this group";
          const input = groupsTableBody.querySelector(`[data-group-invite-input="${groupId}"]`);
          const note = groupsTableBody.querySelector(`[data-group-invite-note="${groupId}"]`);
          const nextInviteCode = String(input?.value || "").trim();
          if (!nextInviteCode) {
            if (note) {
              note.textContent = "Enter a new invite code first.";
            }
            return;
          }

          button.disabled = true;
          try {
            await adminFetch(`/admin/groups/${groupId}`, {
              method: "PATCH",
              body: JSON.stringify({ inviteCode: nextInviteCode }),
            });
            if (input) {
              input.value = "";
            }
            if (note) {
              note.textContent = `Saved once: ${nextInviteCode}`;
            }
            setMessage(createGroupMessage, `Invite code updated for ${groupName}.`, "success");
          } catch (error) {
            if (note) {
              note.textContent = error.message;
            }
            setMessage(createGroupMessage, error.message, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    function renderCodes(codes) {
      codesTableBody.innerHTML = "";
      if (!codes.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="7">No codes found for this filter.</td>';
        codesTableBody.appendChild(row);
        return;
      }
      codes.forEach((code) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><code>${escapeHtml(code.code)}</code></td>
          <td>${platformName(code.platform)}</td>
          <td><span class="promo-tag ${code.status === "available" ? "promo-tag-available" : "promo-tag-claimed"}">${code.expires_at && Date.parse(code.expires_at) <= Date.now() && code.status === "available" ? "expired" : escapeHtml(code.status)}</span></td>
          <td>${escapeHtml(code.batch_label || "-")}</td>
          <td>${escapeHtml(code.claimed_by_email || "-")}</td>
          <td>${escapeHtml(code.claimed_at || code.added_at || "-")}<br><span class="promo-field-hint">Expiry: ${escapeHtml(code.expires_at || "Not set")}</span></td>
          <td>${code.status === "available" ? `<button class="promo-button promo-button-danger" data-delete-code="${code.id}">Delete</button>` : "-"}</td>
        `;
        codesTableBody.appendChild(row);
      });

      codesTableBody.querySelectorAll("[data-delete-code]").forEach((button) => {
        button.addEventListener("click", async () => {
          const codeId = button.getAttribute("data-delete-code");
          button.disabled = true;
          try {
            await adminFetch(`/admin/codes/${codeId}`, { method: "DELETE" });
            setMessage(codesMessage, "Unused code deleted.", "success");
            await loadCodes();
            await refreshSummary();
          } catch (error) {
            setMessage(codesMessage, error.message, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    function renderClaims(claims) {
      claimsTableBody.innerHTML = "";
      if (!claims.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="6">No claims found.</td>';
        claimsTableBody.appendChild(row);
        return;
      }
      claims.forEach((claim) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${escapeHtml(claim.email)}</td>
          <td>${escapeHtml(claim.group_name)}</td>
          <td><code>${escapeHtml(claim.code)}</code></td>
          <td>${platformName(claim.platform)}</td>
          <td>${escapeHtml(claim.claimed_at)}</td>
          <td>${escapeHtml(claim.invite_label || "-")}</td>
        `;
        claimsTableBody.appendChild(row);
      });
    }

    function renderBlacklist(entries) {
      blacklistTableBody.innerHTML = "";
      if (!entries.length) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="4">No blacklisted emails.</td>';
        blacklistTableBody.appendChild(row);
        return;
      }
      entries.forEach((entry) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${escapeHtml(entry.email)}</td>
          <td>${escapeHtml(entry.reason || "-")}</td>
          <td>${escapeHtml(entry.created_at)}</td>
          <td><button class="promo-button promo-button-secondary" data-unblacklist="${escapeHtml(entry.email)}">Remove</button></td>
        `;
        blacklistTableBody.appendChild(row);
      });

      blacklistTableBody.querySelectorAll("[data-unblacklist]").forEach((button) => {
        button.addEventListener("click", async () => {
          const email = button.getAttribute("data-unblacklist");
          button.disabled = true;
          try {
            await adminFetch("/admin/blacklist/remove", {
              method: "POST",
              body: JSON.stringify({ email }),
            });
            setMessage(blacklistMessage, "Email removed from blacklist.", "success");
            await loadBlacklist();
            await refreshSummary();
          } catch (error) {
            setMessage(blacklistMessage, error.message, "error");
          } finally {
            button.disabled = false;
          }
        });
      });
    }

    async function refreshSummary() {
      const summary = await adminFetch("/admin/summary");
      fillSummary(summary);
    }

    async function loadGroups() {
      const groups = await adminFetch("/admin/groups");
      renderGroups(groups.groups);
    }

    async function loadCodes() {
      const groupId = document.getElementById("codes-group-id").value;
      const status = document.getElementById("codes-status").value;
      if (!groupId) {
        codesTableBody.innerHTML = '<tr><td colspan="7">Select a group to inspect codes.</td></tr>';
        return;
      }
      setMessage(codesMessage, "Loading codes...", "muted");
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const platform = document.getElementById("codes-platform").value;
      if (platform) params.set("platform", platform);
      const data = await adminFetch(`/admin/groups/${groupId}/codes?${params.toString()}`);
      renderCodes(data.codes);
      setMessage(codesMessage, `Showing ${data.codes.length} codes.`, "muted");
    }

    async function loadClaims() {
      setMessage(claimsMessage, "Loading claims...", "muted");
      const params = new URLSearchParams();
      const groupId = document.getElementById("claims-group-id").value;
      const email = document.getElementById("claims-email").value.trim();
      if (groupId) params.set("groupId", groupId);
      if (email) params.set("email", email);
      const platform = document.getElementById("claims-platform").value;
      if (platform) params.set("platform", platform);
      const data = await adminFetch(`/admin/claims?${params.toString()}`);
      renderClaims(data.claims);
      setMessage(claimsMessage, `Showing ${data.claims.length} claim records.`, "muted");
    }

    async function loadBlacklist() {
      const data = await adminFetch("/admin/blacklist");
      renderBlacklist(data.entries);
    }

    async function refreshDashboard() {
      await refreshSummary();
      await loadGroups();
      await loadClaims();
      await loadBlacklist();
      await loadCodes();
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) {
        setMessage(loginMessage, "Enter username and password.", "error");
        return;
      }
      adminAuth = btoa(`${username}:${password}`);
      sessionStorage.setItem("promo_admin_auth", adminAuth);
      setMessage(loginMessage, "Signing in...", "muted");
      try {
        await refreshDashboard();
        setLoggedIn(true);
        clearAdminLoginFields();
        setMessage(loginMessage, "", "");
      } catch (error) {
        sessionStorage.removeItem("promo_admin_auth");
        adminAuth = "";
        setMessage(loginMessage, error.message, "error");
      }
    });

    logoutButton.addEventListener("click", () => {
      sessionStorage.removeItem("promo_admin_auth");
      adminAuth = "";
      clearAdminLoginFields();
      setLoggedIn(false);
      setMessage(loginMessage, "", "");
      usernameInput?.focus();
    });

    refreshButton.addEventListener("click", async () => {
      try {
        await refreshDashboard();
      } catch (error) {
        setMessage(createGroupMessage, error.message, "error");
      }
    });

    createGroupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = document.getElementById("group-name").value.trim();
      const inviteCode = document.getElementById("group-invite-code").value.trim();
      if (!name || !inviteCode) {
        setMessage(createGroupMessage, "Group name and invite code are required.", "error");
        return;
      }
      try {
        await adminFetch("/admin/groups", {
          method: "POST",
          body: JSON.stringify({ name, inviteCode }),
        });
        createGroupForm.reset();
        setMessage(createGroupMessage, "Group created.", "success");
        await refreshDashboard();
      } catch (error) {
        setMessage(createGroupMessage, error.message, "error");
      }
    });

    importForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const groupId = document.getElementById("import-group-id").value;
      const batchLabel = document.getElementById("batch-label").value.trim();
      const platform = document.getElementById("import-platform").value;
      const expiryInput = document.getElementById("codes-expiry").value;
      if (platform === "ios" && !expiryInput) {
        setMessage(importMessage, "Enter the Apple batch expiry in UTC before importing iOS codes.", "error");
        return;
      }
      const expiryDate = expiryInput ? new Date(expiryInput + "Z") : null;
      if (expiryDate && !Number.isFinite(expiryDate.getTime())) {
        setMessage(importMessage, "Enter a valid expiry date and time in UTC.", "error");
        return;
      }
      const expiresAt = expiryDate ? expiryDate.toISOString() : null;
      const textareaValue = document.getElementById("codes-text").value.trim();
      if (!groupId) {
        setMessage(importMessage, "Choose a group before importing.", "error");
        return;
      }

      let codesText = textareaValue;
      if (!codesText && fileInput.files[0]) {
        codesText = await fileInput.files[0].text();
      }
      if (!codesText) {
        setMessage(importMessage, "Paste codes or choose a CSV file.", "error");
        return;
      }
      try {
        const result = await adminFetch(`/admin/groups/${groupId}/codes/import`, {
          method: "POST",
          body: JSON.stringify({ codesText, batchLabel, platform, expiresAt }),
        });
        importForm.reset();
        setMessage(importMessage, `Imported ${result.insertedCount} new codes. ${result.skippedCount} duplicate or empty values skipped.`, "success");
        await refreshDashboard();
      } catch (error) {
        setMessage(importMessage, error.message, "error");
      }
    });

    blacklistForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = document.getElementById("blacklist-email").value.trim().toLowerCase();
      const reason = document.getElementById("blacklist-reason").value.trim();
      if (!isValidEmail(email)) {
        setMessage(blacklistMessage, "Enter a valid email.", "error");
        return;
      }
      try {
        await adminFetch("/admin/blacklist", {
          method: "POST",
          body: JSON.stringify({ email, reason }),
        });
        blacklistForm.reset();
        setMessage(blacklistMessage, "Email added to blacklist.", "success");
        await loadBlacklist();
        await refreshSummary();
      } catch (error) {
        setMessage(blacklistMessage, error.message, "error");
      }
    });

    codesExplorerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await loadCodes();
      } catch (error) {
        setMessage(codesMessage, error.message, "error");
      }
    });

    claimsFilterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await loadClaims();
      } catch (error) {
        setMessage(claimsMessage, error.message, "error");
      }
    });

    if (adminAuth) {
      try {
        await refreshDashboard();
        setLoggedIn(true);
      } catch (error) {
        sessionStorage.removeItem("promo_admin_auth");
        adminAuth = "";
        setLoggedIn(false);
      }
    } else {
      setLoggedIn(false);
    }
  }

  if (document.body.dataset.page === "promo-redeem") {
    initRedeemPage();
  }
  if (document.body.dataset.page === "promo-admin") {
    initAdminPage();
  }
})();
