document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const sendMethodSelect = document.getElementById('send_method');
    const smtpInputsSection = document.getElementById('smtp-inputs-section');
    const gmailApiSection = document.getElementById('gmail-api-section');
    const googleLoginBtn = document.getElementById('google-login-btn');
    const googleLogoutBtn = document.getElementById('google-logout-btn');
    const authDot = document.getElementById('auth-dot');
    const authStatusText = document.getElementById('auth-status-text');

    const smtpForm = document.getElementById('smtp-form');
    const smtpServerInput = document.getElementById('smtp_server');
    const smtpPortInput = document.getElementById('smtp_port');
    const smtpSecuritySelect = document.getElementById('smtp_security');
    const senderEmailInput = document.getElementById('sender_email');
    const senderPasswordInput = document.getElementById('sender_password');
    const delaySecondsInput = document.getElementById('delay_seconds');

    const contactsInput = document.getElementById('contacts_file');
    const contactsDropzone = document.getElementById('contacts-dropzone');
    const contactsFilename = document.getElementById('contacts-filename');

    const resumeInput = document.getElementById('resume_file');
    const resumeDropzone = document.getElementById('resume-dropzone');
    const resumeFilename = document.getElementById('resume-filename');

    const detectedPlaceholdersContainer = document.getElementById('detected-placeholders');
    const templateSubjectInput = document.getElementById('template_subject');
    const templateBodyInput = document.getElementById('template_body');

    const previewSubjectOut = document.getElementById('preview-subject-out');
    const previewBodyOut = document.getElementById('preview-body-out');
    const previewAttachmentOut = document.getElementById('preview-attachment-out');

    const dryRunToggle = document.getElementById('dry_run_toggle');
    const sendEmailsBtn = document.getElementById('send-emails-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressStatusText = document.getElementById('progress-status-text');
    const progressPercentText = document.getElementById('progress-percent-text');
    const progressBarFill = document.getElementById('progress-bar-fill');

    const logsContainer = document.getElementById('logs-container');
    const logsList = document.getElementById('logs-list');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    const filterBtns = document.querySelectorAll('.filter-btn');

    // Chatbot Widget Elements
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    const chatCloseBtn = document.getElementById('chat-close-btn');
    const chatDrawer = document.getElementById('chat-drawer');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatAttachBtn = document.getElementById('chat-attach-btn');
    const chatFileInput = document.getElementById('chat_file');
    const chatFilePreview = document.getElementById('chat-file-preview');
    const previewFilenameText = document.getElementById('preview-filename-text');
    const chatClearFileBtn = document.getElementById('chat-clear-file-btn');
    const chatUnreadBadge = document.querySelector('.chat-unread-badge');

    // State Variables
    let selectedContactsFile = null;
    let selectedResumeFile = null;
    let excelColumns = ['Name', 'Company', 'Role']; 
    let previewContactData = null; 
    let lastFocusedInput = templateBodyInput; 
    let logsData = [];
    let currentFilter = 'all';
    let totalEmails = 0;
    let successCount = 0;
    let failCount = 0;
    let allContacts = [];
    let modalResolveFn = null;

    // Chat State
    let attachedChatFile = null;
    let isChatOpen = false;

    // 1. Connection Method Selector Toggle
    sendMethodSelect.addEventListener('change', () => {
        const method = sendMethodSelect.value;
        if (method === 'smtp') {
            smtpInputsSection.classList.remove('hidden');
            gmailApiSection.classList.add('hidden');
        } else {
            smtpInputsSection.classList.add('hidden');
            gmailApiSection.classList.remove('hidden');
            checkGmailAuthStatus();
        }
    });

    // 2. Gmail API OAuth Status & Authentication
    async function checkGmailAuthStatus() {
        if (!authDot || !authStatusText || !googleLoginBtn || !googleLogoutBtn) return;
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            
            if (data.authenticated) {
                authDot.className = 'status-dot online';
                authStatusText.textContent = 'Authenticated';
                googleLoginBtn.classList.add('hidden');
                googleLogoutBtn.classList.remove('hidden');
            } else {
                authDot.className = 'status-dot disconnected';
                authStatusText.textContent = 'Not Authenticated';
                googleLoginBtn.classList.remove('hidden');
                googleLogoutBtn.classList.add('hidden');
            }
        } catch (e) {
            console.error("Failed to check auth status", e);
        }
    }

    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/auth/gmail');
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || 'Failed to start OAuth flow.');
                }
                const data = await res.json();
                // Redirect the user to Google Login Screen
                window.location.href = data.auth_url;
            } catch (e) {
                showToast('Google login error: ' + e.message, 'error');
            }
        });
    }

    if (googleLogoutBtn) {
        googleLogoutBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/auth/logout', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showToast('Google account disconnected successfully.', 'success');
                    checkGmailAuthStatus();
                }
            } catch (e) {
                showToast('Logout error: ' + e.message, 'error');
            }
        });
    }

    // 3. Load Local SMTP Configuration
    function loadSavedSettings() {
        try {
            const saved = localStorage.getItem('cold_email_smtp_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                smtpServerInput.value = settings.smtp_server || 'smtp.gmail.com';
                smtpPortInput.value = settings.smtp_port || '587';
                smtpSecuritySelect.value = settings.smtp_security || 'tls';
                senderEmailInput.value = settings.sender_email || '';
                senderPasswordInput.value = settings.sender_password || '';
                delaySecondsInput.value = settings.delay_seconds || '2.0';
                sendMethodSelect.value = settings.send_method || 'smtp';
                
                // Trigger view toggle
                sendMethodSelect.dispatchEvent(new Event('change'));
            }
        } catch (e) {
            console.error("Failed to load settings", e);
        }
    }

    async function loadBackendEnvDefaults() {
        try {
            const res = await fetch('/api/config/smtp');
            if (res.ok) {
                const defaults = await res.json();
                const saved = localStorage.getItem('cold_email_smtp_settings');
                if (!saved) {
                    if (defaults.smtp_server) smtpServerInput.value = defaults.smtp_server;
                    if (defaults.smtp_port) smtpPortInput.value = defaults.smtp_port;
                    if (defaults.sender_email) senderEmailInput.value = defaults.sender_email;
                    if (defaults.has_password) {
                        senderPasswordInput.value = "••••••••••••••••";
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load backend defaults", e);
        }
    }

    // Save configuration
    smtpForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const settings = {
            smtp_server: smtpServerInput.value,
            smtp_port: parseInt(smtpPortInput.value) || 587,
            smtp_security: smtpSecuritySelect.value,
            sender_email: senderEmailInput.value,
            sender_password: senderPasswordInput.value,
            delay_seconds: parseFloat(delaySecondsInput.value) || 2.0,
            send_method: sendMethodSelect.value
        };
        try {
            localStorage.setItem('cold_email_smtp_settings', JSON.stringify(settings));
            showToast('Configuration saved successfully!', 'success');
        } catch (err) {
            showToast('Failed to save settings: ' + err.message, 'error');
        }
    });

    // 4. Setup Upload Dropzones
    function setupDropzone(dropzone, input, filenameEl, fileTypeLabel, callback) {
        dropzone.addEventListener('click', (e) => {
            if (e.target !== input) {
                input.click();
            }
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('dragover');
            }, false);
        });

        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                input.files = files;
                handleFileSelect(files[0]);
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
        });

        function handleFileSelect(file) {
            if (fileTypeLabel === 'PDF' && !file.name.toLowerCase().endsWith('.pdf')) {
                showToast('Please upload a valid PDF file.', 'error');
                return;
            }
            if (fileTypeLabel === 'Excel' && !file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls') && !file.name.toLowerCase().endsWith('.csv')) {
                showToast('Please upload a valid Excel (.xlsx, .xls) or CSV file.', 'error');
                return;
            }

            dropzone.classList.add('has-file');
            filenameEl.textContent = file.name;
            callback(file);
        }
    }

    setupDropzone(contactsDropzone, contactsInput, contactsFilename, 'Excel', (file) => {
        selectedContactsFile = file;
        fetchPreview();
    });

    setupDropzone(resumeDropzone, resumeInput, resumeFilename, 'PDF', (file) => {
        selectedResumeFile = file;
        previewAttachmentOut.textContent = `📎 ${file.name}`;
        previewAttachmentOut.classList.add('has-attachment');
        showToast('Resume uploaded.', 'success');
    });

    // 5. Focus Tracking & Placeholders
    templateSubjectInput.addEventListener('focus', () => lastFocusedInput = templateSubjectInput);
    templateBodyInput.addEventListener('focus', () => lastFocusedInput = templateBodyInput);

    // ── Editor Toolbar & Ctrl+K Link Insertion ─────────────────────────────
    const linkPopover      = document.getElementById('link-popover');
    const linkTextInput    = document.getElementById('link-text-input');
    const linkUrlInput     = document.getElementById('link-url-input');
    const linkInsertBtn    = document.getElementById('link-insert-btn');
    const linkCancelBtn    = document.getElementById('link-cancel-btn');
    const linkPopoverClose = document.getElementById('link-popover-close');
    const toolbarLinkBtn   = document.getElementById('toolbar-link-btn');
    const toolbarBoldBtn   = document.getElementById('toolbar-bold-btn');
    const toolbarItalicBtn = document.getElementById('toolbar-italic-btn');
    const toolbarUnlinkBtn = document.getElementById('toolbar-unlink-btn');

    // Track the caret/selection when user was last typing so we can insert back
    let savedBodySelection = { start: 0, end: 0 };

    function saveBodySelection() {
        savedBodySelection = {
            start: templateBodyInput.selectionStart,
            end:   templateBodyInput.selectionEnd
        };
    }

    templateBodyInput.addEventListener('keyup',   saveBodySelection);
    templateBodyInput.addEventListener('mouseup',  saveBodySelection);
    templateBodyInput.addEventListener('select',   saveBodySelection);

    function openLinkPopover() {
        // Pre-fill link text with the selected text in the textarea
        const selectedText = templateBodyInput.value.substring(
            savedBodySelection.start,
            savedBodySelection.end
        ).trim();
        linkTextInput.value = selectedText || '';
        linkUrlInput.value  = '';
        linkPopover.classList.remove('hidden');
        // Focus the appropriate field
        setTimeout(() => (selectedText ? linkUrlInput.focus() : linkTextInput.focus()), 50);
    }

    function closeLinkPopover() {
        linkPopover.classList.add('hidden');
        linkTextInput.value = '';
        linkUrlInput.value  = '';
        templateBodyInput.focus();
    }

    function insertLink() {
        const text = linkTextInput.value.trim();
        const url  = linkUrlInput.value.trim();

        if (!url) {
            linkUrlInput.focus();
            linkUrlInput.style.borderColor = 'var(--error-color)';
            setTimeout(() => linkUrlInput.style.borderColor = '', 1500);
            return;
        }
        if (!text) {
            linkTextInput.focus();
            linkTextInput.style.borderColor = 'var(--error-color)';
            setTimeout(() => linkTextInput.style.borderColor = '', 1500);
            return;
        }

        const htmlLink  = `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        const bodyVal   = templateBodyInput.value;
        const before    = bodyVal.substring(0, savedBodySelection.start);
        const after     = bodyVal.substring(savedBodySelection.end);

        templateBodyInput.value = before + htmlLink + after;

        // Place cursor after the inserted link
        const newPos = savedBodySelection.start + htmlLink.length;
        templateBodyInput.setSelectionRange(newPos, newPos);

        closeLinkPopover();
        updateLivePreview();
        showToast(`Link to "${text}" inserted!`, 'success');
    }

    // Toolbar button listeners
    toolbarLinkBtn.addEventListener('click', () => {
        saveBodySelection();
        openLinkPopover();
    });

    linkInsertBtn.addEventListener('click',    insertLink);
    linkCancelBtn.addEventListener('click',    closeLinkPopover);
    linkPopoverClose.addEventListener('click', closeLinkPopover);

    // Insert link on Enter inside the URL field
    linkUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
        if (e.key === 'Escape') { e.preventDefault(); closeLinkPopover(); }
    });
    linkTextInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); linkUrlInput.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); closeLinkPopover(); }
    });

    // Bold button — wraps selected text in <b>...</b>
    toolbarBoldBtn.addEventListener('click', () => {
        wrapSelection('<b>', '</b>');
    });

    // Italic button — wraps selected text in <i>...</i>
    toolbarItalicBtn.addEventListener('click', () => {
        wrapSelection('<i>', '</i>');
    });

    // Unlink button — removes the nearest <a href> wrapping around the selection
    toolbarUnlinkBtn.addEventListener('click', () => {
        const val   = templateBodyInput.value;
        const start = templateBodyInput.selectionStart;
        const end   = templateBodyInput.selectionEnd;
        const selected = val.substring(start, end);
        // Strip any <a ...>...</a> in selection
        const stripped = selected.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');
        templateBodyInput.value = val.substring(0, start) + stripped + val.substring(end);
        templateBodyInput.setSelectionRange(start, start + stripped.length);
        updateLivePreview();
    });

    // Helper: wraps selected body text with open/close tags
    function wrapSelection(openTag, closeTag) {
        const start    = templateBodyInput.selectionStart;
        const end      = templateBodyInput.selectionEnd;
        const val      = templateBodyInput.value;
        const selected = val.substring(start, end) || '';
        const wrapped  = openTag + selected + closeTag;
        templateBodyInput.value = val.substring(0, start) + wrapped + val.substring(end);
        // Keep selection over inner text
        const innerStart = start + openTag.length;
        const innerEnd   = innerStart + selected.length;
        templateBodyInput.setSelectionRange(innerStart, innerEnd);
        templateBodyInput.focus();
        updateLivePreview();
    }

    // Ctrl+K shortcut inside the body textarea → open link popover
    templateBodyInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            saveBodySelection();
            openLinkPopover();
        }
        // Ctrl+B Bold
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            wrapSelection('<b>', '</b>');
        }
        // Ctrl+I Italic
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            wrapSelection('<i>', '</i>');
        }
    });
    // ──────────────────────────────────────────────────────────────────────────

    function updatePlaceholderPills() {
        detectedPlaceholdersContainer.innerHTML = '<span class="placeholder-label">Placeholders:</span>';
        
        excelColumns.forEach(col => {
            const pill = document.createElement('span');
            pill.className = 'placeholder-pill';
            pill.textContent = `{${col}}`;
            pill.addEventListener('click', () => {
                insertPlaceholder(col);
            });
            detectedPlaceholdersContainer.appendChild(pill);
        });
    }

    function insertPlaceholder(colName) {
        const textToInsert = `{${colName}}`;
        const input = lastFocusedInput;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        
        input.value = text.substring(0, start) + textToInsert + text.substring(end);
        input.focus();
        
        const newCursorPos = start + textToInsert.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
        updateLivePreview();
    }

    function extractNameFromEmail(email) {
        if (!email || !email.includes('@')) return '';
        let localPart = email.split('@')[0];
        localPart = localPart.replace(/[0-9]/g, '');
        let parts = localPart.split(/[._-]/);
        parts = parts.filter(p => p.length > 0);
        if (parts.length === 0) return '';
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }

    // 6. Live Preview Builder
    function updateLivePreview() {
        const subjectTpl = templateSubjectInput.value || '';
        const bodyTpl = templateBodyInput.value || '';

        let data = {
            'Name': 'Jane Doe',
            'Company': 'Google',
            'Role': 'Software Engineer'
        };

        if (previewContactData) {
            data = previewContactData;
        }

        let subjectOut = subjectTpl;
        let bodyOut = bodyTpl;

        const cleanData = {};
        for (let k in data) {
            cleanData[k.trim().toLowerCase()] = data[k];
        }

        // 1. Detect standard columns in the row data
        let nameKey = null;
        let companyKey = null;
        let roleKey = null;
        let emailKey = null;

        for (let key in cleanData) {
            const kClean = key.trim().toLowerCase();
            if (kClean.includes('email') || kClean.includes('mail')) {
                if (!emailKey) emailKey = key;
            } else if (kClean.includes('name') || kClean.includes('contact') || kClean.includes('hr')) {
                if (!kClean.includes('company') && !kClean.includes('role') && !kClean.includes('firm') && !kClean.includes('title')) {
                    if (!nameKey) nameKey = key;
                }
            } else if (kClean.includes('company') || kClean.includes('organization') || kClean.includes('firm')) {
                if (!companyKey) companyKey = key;
            } else if (kClean.includes('role') || kClean.includes('position') || kClean.includes('designation') || kClean.includes('title')) {
                if (!roleKey) roleKey = key;
            }
        }

        // 2. Resolve values
        let resolvedName = null;
        if (nameKey && cleanData[nameKey]) {
            resolvedName = cleanData[nameKey];
        } else {
            let emailVal = null;
            if (emailKey && cleanData[emailKey] && cleanData[emailKey].includes('@')) {
                emailVal = cleanData[emailKey];
            } else {
                for (let k in cleanData) {
                    if (cleanData[k] && cleanData[k].includes('@')) {
                        emailVal = cleanData[k];
                        break;
                    }
                }
            }
            if (emailVal) {
                resolvedName = extractNameFromEmail(emailVal);
            }
        }

        let resolvedCompany = null;
        if (companyKey && cleanData[companyKey]) {
            resolvedCompany = cleanData[companyKey];
        }

        let resolvedRole = null;
        if (roleKey && cleanData[roleKey]) {
            resolvedRole = cleanData[roleKey];
        }

        // 3. Replace placeholders in the template text (replacing standards first)
        if (resolvedName) {
            subjectOut = subjectOut.replaceAll('{name}', resolvedName);
            subjectOut = subjectOut.replaceAll('{Name}', resolvedName);
            subjectOut = subjectOut.replaceAll('{NAME}', resolvedName);
            bodyOut = bodyOut.replaceAll('{name}', resolvedName);
            bodyOut = bodyOut.replaceAll('{Name}', resolvedName);
            bodyOut = bodyOut.replaceAll('{NAME}', resolvedName);

            for (let k in data) {
                const cLower = k.trim().toLowerCase();
                if (cLower.includes('name') || cLower.includes('contact') || cLower.includes('hr')) {
                    if (!cLower.includes('company') && !cLower.includes('role') && !cLower.includes('firm') && !cLower.includes('title')) {
                        subjectOut = subjectOut.replaceAll(`{${k}}`, resolvedName);
                        bodyOut = bodyOut.replaceAll(`{${k}}`, resolvedName);
                    }
                }
            }
        }

        if (resolvedCompany) {
            subjectOut = subjectOut.replaceAll('{company}', resolvedCompany);
            subjectOut = subjectOut.replaceAll('{Company}', resolvedCompany);
            subjectOut = subjectOut.replaceAll('{COMPANY}', resolvedCompany);
            bodyOut = bodyOut.replaceAll('{company}', resolvedCompany);
            bodyOut = bodyOut.replaceAll('{Company}', resolvedCompany);
            bodyOut = bodyOut.replaceAll('{COMPANY}', resolvedCompany);

            for (let k in data) {
                const cLower = k.trim().toLowerCase();
                if (cLower.includes('company') || cLower.includes('organization') || cLower.includes('firm')) {
                    subjectOut = subjectOut.replaceAll(`{${k}}`, resolvedCompany);
                    bodyOut = bodyOut.replaceAll(`{${k}}`, resolvedCompany);
                }
            }
        }

        if (resolvedRole) {
            subjectOut = subjectOut.replaceAll('{role}', resolvedRole);
            subjectOut = subjectOut.replaceAll('{Role}', resolvedRole);
            subjectOut = subjectOut.replaceAll('{ROLE}', resolvedRole);
            bodyOut = bodyOut.replaceAll('{role}', resolvedRole);
            bodyOut = bodyOut.replaceAll('{Role}', resolvedRole);
            bodyOut = bodyOut.replaceAll('{ROLE}', resolvedRole);

            for (let k in data) {
                const cLower = k.trim().toLowerCase();
                if (cLower.includes('role') || cLower.includes('position') || cLower.includes('designation') || cLower.includes('title')) {
                    subjectOut = subjectOut.replaceAll(`{${k}}`, resolvedRole);
                    bodyOut = bodyOut.replaceAll(`{${k}}`, resolvedRole);
                }
            }
        }

        // Replace any remaining custom placeholders
        for (let k in data) {
            subjectOut = subjectOut.replaceAll(`{${k}}`, data[k] || '');
            bodyOut = bodyOut.replaceAll(`{${k}}`, data[k] || '');
        }

        previewSubjectOut.textContent = subjectOut || '(Subject will be empty)';
        previewBodyOut.innerHTML = formatBodyText(bodyOut) || '(Body content will be empty)';

        const recipientMeta = document.getElementById('preview-recipient-meta');
        const previewToEmail = document.getElementById('preview-to-email');
        const previewToName = document.getElementById('preview-to-name');
        
        if (previewContactData) {
            let emailVal = '';
            if (emailKey && cleanData[emailKey]) {
                emailVal = cleanData[emailKey];
            } else {
                for (let k in cleanData) {
                    if (cleanData[k] && cleanData[k].includes('@')) {
                        emailVal = cleanData[k];
                        break;
                    }
                }
            }
            previewToEmail.textContent = emailVal || 'None';
            previewToName.textContent = `Resolved Name: ${resolvedName || 'Friend'}`;
            recipientMeta.style.display = 'block';
        } else {
            recipientMeta.style.display = 'none';
        }
    }

    function formatBodyText(text) {
        if (!text) return '';
        const hasHtml = /<[a-z][\s\S]*>/i.test(text);
        if (hasHtml) return text;
        return text.replace(/\n/g, '<br>');
    }

    templateSubjectInput.addEventListener('input', updateLivePreview);
    templateBodyInput.addEventListener('input', updateLivePreview);

    // 7. Fetch Excel preview metadata from FastAPI
    async function fetchPreview() {
        if (!selectedContactsFile) return;

        const formData = new FormData();
        formData.append('excel_file', selectedContactsFile);
        formData.append('template_subject', templateSubjectInput.value);
        formData.append('template_body', templateBodyInput.value);

        try {
            const res = await fetch('/api/preview', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || 'Could not analyze contact sheet.');
            }

            const result = await res.json();
            
            if (result.success) {
                excelColumns = result.all_columns;
                updatePlaceholderPills();
                allContacts = result.contacts || [];
                
                if (result.previews && result.previews.length > 0) {
                    previewContactData = result.previews[0].row_data;
                    updateLivePreview();
                    showToast(`Loaded ${result.total_valid_contacts} contacts from sheet!`, 'success');
                } else {
                    showToast('No valid contact emails found in sheet.', 'warning');
                }
            }
        } catch (err) {
            showToast('Preview error: ' + err.message, 'error');
        }
    }

    // 8. Settings validation
    function validateBroadcasterSettings(isDryRun) {
        if (isDryRun) return true;
        
        const method = sendMethodSelect.value;
        if (method === 'smtp') {
            if (!smtpServerInput.value || !smtpPortInput.value || !senderEmailInput.value || !senderPasswordInput.value) {
                showToast('Please fill out all SMTP Settings in Connection panel.', 'error');
                return false;
            }
        } else {
            // Gmail API checking
            if (authStatusText.textContent !== 'Authenticated') {
                showToast('Please authenticate with your Gmail Account first.', 'error');
                return false;
            }
        }
        return true;
    }

    // Modal Helpers
    function showApprovalModal(recipientEmail, subject, body, currentIndex, totalCount, resolvedName) {
        return new Promise((resolve) => {
            document.getElementById('modal-current-index').textContent = currentIndex;
            document.getElementById('modal-total-count').textContent = totalCount;
            document.getElementById('modal-recipient-email').textContent = recipientEmail;
            document.getElementById('modal-subject-input').value = subject;
            document.getElementById('modal-body-input').value = body;
            
            const fetchedNameEl = document.getElementById('modal-fetched-name');
            fetchedNameEl.textContent = `Fetched Name: ${resolvedName || 'Friend'}`;
            
            const attachInfo = document.getElementById('modal-attachment-info');
            if (selectedResumeFile) {
                attachInfo.textContent = `📎 Resume attachment: ${selectedResumeFile.name}`;
                attachInfo.style.color = 'var(--neon-blue)';
            } else {
                attachInfo.textContent = `📎 Resume attachment: None`;
                attachInfo.style.color = 'var(--text-muted)';
            }
            
            const modal = document.getElementById('approval-modal');
            modal.classList.remove('hidden');
            // Force reflow
            modal.offsetHeight;
            modal.classList.add('active');
            
            modalResolveFn = resolve;
        });
    }

    function closeApprovalModal() {
        const modal = document.getElementById('approval-modal');
        modal.classList.remove('active');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    }

    // Modal Action Bindings
    const modalSkipBtn = document.getElementById('modal-skip-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalAutoApproveBtn = document.getElementById('modal-auto-approve-btn');
    const modalApproveSendBtn = document.getElementById('modal-approve-send-btn');

    modalSkipBtn.addEventListener('click', () => {
        if (modalResolveFn) {
            closeApprovalModal();
            modalResolveFn({ status: 'skip' });
            modalResolveFn = null;
        }
    });

    modalCancelBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to cancel the entire email sending job?")) {
            if (modalResolveFn) {
                closeApprovalModal();
                modalResolveFn({ status: 'cancel' });
                modalResolveFn = null;
            }
        }
    });

    modalAutoApproveBtn.addEventListener('click', () => {
        if (confirm("This will auto-approve and send all remaining emails without pausing. Proceed?")) {
            if (modalResolveFn) {
                closeApprovalModal();
                modalResolveFn({
                    status: 'auto_approve',
                    subject: document.getElementById('modal-subject-input').value,
                    body: document.getElementById('modal-body-input').value
                });
                modalResolveFn = null;
            }
        }
    });

    modalApproveSendBtn.addEventListener('click', () => {
        if (modalResolveFn) {
            closeApprovalModal();
            modalResolveFn({
                status: 'approve',
                subject: document.getElementById('modal-subject-input').value,
                body: document.getElementById('modal-body-input').value
            });
            modalResolveFn = null;
        }
    });

    // 9. Operations Handler: Send Emails
    let isSendCancelled = false;

    sendEmailsBtn.addEventListener('click', async () => {
        const isDryRun = dryRunToggle.checked;

        if (!selectedContactsFile || allContacts.length === 0) {
            showToast('Please upload an Excel/CSV file containing contacts (or extract via AI).', 'error');
            return;
        }
        if (!validateBroadcasterSettings(isDryRun)) {
            return;
        }

        if (!isDryRun) {
            const confirmSend = confirm("WARNING: You are about to send real emails to your contacts list. Proceed?");
            if (!confirmSend) return;
        }

        setUIProcessing(true);
        progressContainer.classList.remove('hidden');
        logsContainer.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressStatusText.textContent = isDryRun ? 'Simulating...' : 'Transmitting jobs...';
        progressPercentText.textContent = '0%';
        
        logsData = [];
        totalEmails = allContacts.length;
        successCount = 0;
        failCount = 0;
        isSendCancelled = false;
        renderLogs();

        appendLog({
            type: 'info',
            email: 'System',
            msg: `Broadcasting session started. Total records: ${totalEmails}. (Dry Run: ${isDryRun})`
        });

        for (let idx = 0; idx < allContacts.length; idx++) {
            if (isSendCancelled) {
                appendLog({
                    type: 'info',
                    email: 'System',
                    msg: 'Bulk sending job was cancelled by the user.'
                });
                break;
            }

            const contact = allContacts[idx];
            const autoApprove = document.getElementById('auto_approve_toggle').checked;

            let finalSubject = templateSubjectInput.value;
            let finalBody = templateBodyInput.value;
            let sendRowData = JSON.stringify(contact.row_data);

            if (!autoApprove) {
                // Pause and request manual approval / compilation
                progressStatusText.textContent = `Waiting for approval: ${contact.email} (${idx + 1} of ${totalEmails})`;
                try {
                    const compileRes = await fetch('/api/compile-template', {
                        method: 'POST',
                        body: new URLSearchParams({
                            template_subject: templateSubjectInput.value,
                            template_body: templateBodyInput.value,
                            row_data_json: sendRowData
                        })
                    });
                    if (!compileRes.ok) {
                        const errTxt = await compileRes.text();
                        throw new Error(`Failed to compile template: ${errTxt}`);
                    }
                    const compileData = await compileRes.json();

                    // Display modal and wait for action
                    const userAction = await showApprovalModal(
                        contact.email,
                        compileData.subject,
                        compileData.body,
                        idx + 1,
                        totalEmails,
                        compileData.resolved_name
                    );

                    if (userAction.status === 'cancel') {
                        isSendCancelled = true;
                        break;
                    } else if (userAction.status === 'skip') {
                        appendLog({
                            type: 'info',
                            email: contact.email,
                            msg: `Skipped by user.`
                        });
                        updateProgressBar(idx + 1, totalEmails);
                        continue;
                    } else if (userAction.status === 'auto_approve') {
                        document.getElementById('auto_approve_toggle').checked = true;
                        finalSubject = userAction.subject;
                        finalBody = userAction.body;
                        sendRowData = null; // Compiled values are being sent directly
                    } else if (userAction.status === 'approve') {
                        finalSubject = userAction.subject;
                        finalBody = userAction.body;
                        sendRowData = null; // Compiled values are being sent directly
                    }
                } catch (compileErr) {
                    appendLog({
                        type: 'error',
                        email: contact.email,
                        msg: `Compilation error: ${compileErr.message}`
                    });
                    failCount++;
                    updateProgressBar(idx + 1, totalEmails);
                    continue;
                }
            }

            // Proceed to send the email
            progressStatusText.textContent = `Sending to: ${contact.email} (${idx + 1} of ${totalEmails})`;

            const formData = new FormData();
            formData.append('recipient_email', contact.email);
            formData.append('subject', finalSubject);
            formData.append('body', finalBody);
            if (sendRowData) {
                formData.append('row_data_json', sendRowData);
            }
            if (selectedResumeFile) {
                formData.append('resume_file', selectedResumeFile);
            }
            formData.append('send_method', sendMethodSelect.value);
            formData.append('dry_run', isDryRun);

            if (sendMethodSelect.value === 'smtp') {
                formData.append('smtp_server', smtpServerInput.value);
                formData.append('smtp_port', smtpPortInput.value);
                formData.append('sender_email', senderEmailInput.value);
                formData.append('sender_password', senderPasswordInput.value);
                
                const sec = smtpSecuritySelect.value;
                formData.append('use_tls', sec === 'tls');
                formData.append('use_ssl', sec === 'ssl');
            }

            try {
                const sendRes = await fetch('/api/send-single', {
                    method: 'POST',
                    body: formData
                });

                if (!sendRes.ok) {
                    const errText = await sendRes.text();
                    throw new Error(`HTTP Error ${sendRes.status}: ${errText}`);
                }

                const sendData = await sendRes.json();
                if (isDryRun) {
                    appendLog({
                        type: 'info',
                        email: contact.email,
                        msg: sendData.message
                    });
                } else {
                    successCount++;
                    appendLog({
                        type: 'success',
                        email: contact.email,
                        msg: sendData.message
                    });
                }
            } catch (sendErr) {
                failCount++;
                appendLog({
                    type: 'error',
                    email: contact.email,
                    msg: `Failed: ${sendErr.message}`
                });
            }

            updateProgressBar(idx + 1, totalEmails);

            // Delay between emails (if not the last one, and if auto-approval was checked or selected)
            if (idx < allContacts.length - 1) {
                const delaySec = parseFloat(delaySecondsInput.value) || 2;
                await new Promise(r => setTimeout(r, delaySec * 1000));
            }
        }

        // Broadcaster Concluded
        appendLog({
            type: 'info',
            email: 'System',
            msg: `All email transactions concluded. Completed: ${allContacts.length}`
        });

        progressBarFill.style.width = '100%';
        progressPercentText.textContent = '100%';

        if (isDryRun) {
            progressStatusText.textContent = 'Simulation completed ✓';
            showToast(`Dry run simulation completed! (${allContacts.length} validated)`, 'info');
        } else {
            if (failCount === 0) {
                progressStatusText.textContent = 'Operation completed ✓';
                showToast(`Email broadcast completed successfully! (${successCount} sent)`, 'success');
            } else if (successCount === 0) {
                progressStatusText.textContent = 'Operation failed ✗';
                showToast(`Email broadcast failed! (${failCount} errors, 0 sent)`, 'error');
            } else {
                progressStatusText.textContent = 'Completed with errors ⚠';
                showToast(`Email broadcast completed with errors. (${successCount} sent, ${failCount} failed)`, 'warning');
            }
        }

        setUIProcessing(false);
    });

    function handleStreamEvent(data) {
        // Obsolete function, retained dynamically to prevent signature references from failing, if any
    }

    function updateProgressBar(current, total) {
        if (!total) return;
        const percent = Math.round((current / total) * 100);
        progressBarFill.style.width = `${percent}%`;
        progressPercentText.textContent = `${percent}%`;
        progressStatusText.textContent = `Processing ${current} of ${total}`;
    }

    function setUIProcessing(isProcessing) {
        if (isProcessing) {
            sendEmailsBtn.disabled = true;
            sendEmailsBtn.textContent = 'Sending...';
            sendEmailsBtn.classList.remove('btn-glow');
        } else {
            sendEmailsBtn.disabled = false;
            sendEmailsBtn.textContent = 'Start Send Job';
            sendEmailsBtn.classList.add('btn-glow');
        }
    }

    // 10. Logs rendering
    function appendLog(logObj) {
        logObj.time = new Date().toLocaleTimeString();
        logsData.push(logObj);
        renderLogs();
    }

    function renderLogs() {
        logsList.innerHTML = '';
        const filtered = logsData.filter(log => {
            if (currentFilter === 'success') return log.type === 'success';
            if (currentFilter === 'fail') return log.type === 'error';
            return true;
        });

        if (filtered.length === 0) {
            logsList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem;">No execution logs found.</div>';
            return;
        }

        filtered.forEach(log => {
            const item = document.createElement('div');
            item.className = `log-item ${log.type}`;
            item.innerHTML = `
                <div class="log-meta">
                    <span class="log-email">${log.email}</span>
                    <span class="log-time">${log.time}</span>
                </div>
                <div class="log-msg">${escapeHtml(log.msg)}</div>
            `;
            logsList.appendChild(item);
        });

        logsList.scrollTop = logsList.scrollHeight;
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderLogs();
        });
    });

    clearLogsBtn.addEventListener('click', () => {
        logsData = [];
        renderLogs();
    });


    // ==========================================================================
    // 11. Chatbot Widget Operations (Groq AI Extractor)
    // ==========================================================================
    
    // Toggle widget panel
    chatToggleBtn.addEventListener('click', () => {
        chatDrawer.classList.toggle('hidden');
        isChatOpen = !chatDrawer.classList.contains('hidden');
        chatUnreadBadge.classList.add('hidden'); // Clear alert badge on open
        
        if (isChatOpen) {
            chatInput.focus();
            chatBody.scrollTop = chatBody.scrollHeight;
        }
    });

    chatCloseBtn.addEventListener('click', () => {
        chatDrawer.classList.add('hidden');
        isChatOpen = false;
    });

    // Trigger file input
    chatAttachBtn.addEventListener('click', () => chatFileInput.click());

    // File input change handler inside Chat
    chatFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            attachedChatFile = e.target.files[0];
            previewFilenameText.textContent = attachedChatFile.name;
            chatFilePreview.classList.remove('hidden');
            showToast('Document attached to message.', 'success');
        }
    });

    // Clear file selection
    chatClearFileBtn.addEventListener('click', () => {
        clearChatAttachment();
    });

    function clearChatAttachment() {
        attachedChatFile = null;
        chatFileInput.value = '';
        chatFilePreview.classList.add('hidden');
    }

    // Submit chat message
    chatSendBtn.addEventListener('click', () => submitChatMessage());
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitChatMessage();
    });

    async function submitChatMessage() {
        const text = chatInput.value.trim();
        const hasFile = attachedChatFile !== null;

        if (!text && !hasFile) return;

        // Append user bubble
        appendChatMsg('user', text || `Uploaded File: ${attachedChatFile.name}`);
        chatInput.value = '';

        // Append loader
        const loaderId = appendChatLoader();

        // Clear files display locally
        const currentFile = attachedChatFile;
        clearChatAttachment();

        // Query Backend
        const formData = new FormData();
        formData.append('message', text || 'Extract email list from this file.');
        if (hasFile) {
            formData.append('file', currentFile);
        }

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                body: formData
            });

            // Remove loader
            removeChatLoader(loaderId);

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'Connection failed.');
            }

            const data = await res.json();
            
            // Render assistant conversational reply
            appendChatMsg('assistant', data.answer);

            // Render inline extraction card if list is loaded
            if (data.contacts && data.contacts.length > 0) {
                appendChatContactsCard(data.contacts);
                
                // Play subtle badge alert if drawer is minimized
                if (!isChatOpen) {
                    chatUnreadBadge.classList.remove('hidden');
                }
            }

        } catch (e) {
            removeChatLoader(loaderId);
            appendChatMsg('assistant', `Failed to query AI assistant: ${e.message}`);
            showToast('Chat error: ' + e.message, 'error');
        }
    }

    function appendChatMsg(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${sender}`;
        
        const avatar = sender === 'user' ? '👤' : '🤖';
        
        msgDiv.innerHTML = `
            <div class="msg-avatar">${avatar}</div>
            <div class="msg-content">${formatMarkdown(text)}</div>
        `;
        
        chatBody.appendChild(msgDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function appendChatLoader() {
        const loaderId = 'loader_' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg assistant';
        msgDiv.id = loaderId;
        msgDiv.innerHTML = `
            <div class="msg-avatar">🤖</div>
            <div class="msg-content">
                <div class="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        chatBody.appendChild(msgDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
        return loaderId;
    }

    function removeChatLoader(loaderId) {
        const loader = document.getElementById(loaderId);
        if (loader) loader.remove();
    }

    function appendChatContactsCard(contacts) {
        const containerDiv = document.createElement('div');
        containerDiv.className = 'chat-msg assistant';
        
        const card = document.createElement('div');
        card.className = 'extracted-contacts-card';
        card.innerHTML = `
            <div class="extracted-title">📊 Contacts Detected!</div>
            <div class="extracted-count">Found ${contacts.length} HR contact records.</div>
        `;

        const importBtn = document.createElement('button');
        importBtn.className = 'btn-import-contacts';
        importBtn.textContent = 'Import to Broadcaster';
        
        importBtn.addEventListener('click', () => {
            loadExtractedContactsToBroadcaster(contacts);
            importBtn.disabled = true;
            importBtn.textContent = 'Loaded ✔';
            importBtn.style.background = 'var(--success-color)';
        });

        card.appendChild(importBtn);
        
        containerDiv.innerHTML = `<div class="msg-avatar">🤖</div>`;
        containerDiv.querySelector('.msg-avatar').after(card);
        
        chatBody.appendChild(containerDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    function loadExtractedContactsToBroadcaster(contacts) {
        try {
            // Build CSV content from parsed JSON contacts list
            let csvContent = "Name,Email,Company,Role\n";
            contacts.forEach(c => {
                const name = (c.Name || '').replace(/"/g, '""');
                const email = (c.Email || '').replace(/"/g, '""');
                const company = (c.Company || '').replace(/"/g, '""');
                const role = (c.Role || '').replace(/"/g, '""');
                csvContent += `"${name}","${email}","${company}","${role}"\n`;
            });

            // Package CSV string into virtual File object in DOM
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const file = new File([blob], "extracted_contacts.csv", { type: "text/csv" });

            // Assign variables to trigger main dashboard loader
            selectedContactsFile = file;
            contactsFilename.textContent = file.name;
            contactsDropzone.classList.add('has-file');

            // Trigger preview pipeline
            fetchPreview();
            showToast(`Loaded ${contacts.length} contacts directly into the sender!`, 'success');
            
            // Smoothly close drawer to show imported previews
            setTimeout(() => {
                chatDrawer.classList.add('hidden');
                isChatOpen = false;
            }, 800);

        } catch (e) {
            showToast('Failed to parse and import contacts: ' + e.message, 'error');
        }
    }

    // A simple formatter for bold markdown blocks **text** and newlines
    function formatMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);
        
        // Match **bold**
        html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
        
        // Convert double returns to paragraphs
        html = html.replace(/\n\n/g, '<br><br>');
        
        // Single return to break
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '25px',
            left: '25px', // Shift to bottom-left so it doesn't overlap the floating chatbot button
            background: type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6',
            color: 'white',
            padding: '0.8rem 1.5rem',
            borderRadius: '10px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
            zIndex: '9999',
            fontFamily: 'inherit',
            fontWeight: '600',
            fontSize: '0.9rem',
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'all 0.3s ease'
        });

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 50);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // Initializations
    loadSavedSettings();
    loadBackendEnvDefaults();
    updatePlaceholderPills();
    updateLivePreview();
    
    // Check Gmail auth status if default method is gmail_api on load
    if (sendMethodSelect.value === 'gmail_api') {
        checkGmailAuthStatus();
    }
});
