# 📧 Cold Email Automator

A modern, glassmorphic web application built to personalize and broadcast resume emails in bulk. Using either a **traditional SMTP server** or the secure **Google Gmail API (OAuth 2.0)**, this tool allows job seekers and outreach managers to send customized emails to a contact list with personalized details (such as names, companies, and roles) and automatically attach resume files.

The project is fully integrated with a **Groq-powered AI Assistant** that can parse lists of contacts from text, screenshots, spreadsheets, or PDFs and import them directly into the broadcaster.

---

## ✨ Features

- **Double-Channel Broadcasting**:
  - **SMTP**: Fast setup with standard mail servers (e.g., Gmail App Passwords, Outlook, Yahoo).
  - **Gmail API (OAuth 2.0)**: Securely authenticate via Google Login and broadcast without storing sensitive passwords.
- **Dynamic Email Template Customization**:
  - Drag and drop contacts in Excel (`.xlsx`/`.xls`) or CSV formats.
  - Automatically identifies spreadsheet headers and maps them as placeholders (e.g., `{Name}`, `{Company}`, `{Role}`).
  - Built-in formatting toolbar for **Bold**, *Italic*, and 🔗 **Links** (with `Ctrl+B`, `Ctrl+I`, and `Ctrl+K` hotkey support).
  - Preserves paragraph spacing, empty line breaks, and block-level HTML tags when rendering/sending.
- **Visual Validation**:
  - **Live Sample Preview**: Interactive preview pane updating letter text instantly as you edit the templates.
  - **Manual Review Mode**: Pause, inspect, edit, or skip personalized emails for each recipient before they go out.
  - **Dry Run Mode**: Simulates the mailing sequence, validating dynamic variables and mapping without triggering real dispatches.
- **Smart AI Assistant**:
  - Floating chatbot powered by Groq LLMs.
  - Send messages or attach files (PDF, spreadsheet, or images/screenshots of contact tables) to extract clean JSON lists of names, emails, roles, and companies, importing them immediately into the sender.
- **Advanced UX/UI**:
  - Sleek dark theme with vibrant glassmorphic gradients and micro-animations.
  - Console-style execution logs with filtering for **Success** and **Failed** dispatches.

---

## 🛠️ Tech Stack

- **Backend**: FastAPI (Python), Uvicorn, Pandas, openpyxl, python-multipart, python-dotenv, google-api-python-client, google-auth-oauthlib, google-auth-httplib2, groq, pypdf
- **Frontend**: Vanilla HTML5, CSS3 (Modern HSL system, variables, custom responsive grid), Vanilla JavaScript ES6
- **Deployment**: Docker & Docker Compose

---

## 🚀 Getting Started

### Prerequisites
- Python 3.12+ installed.
- (Optional) Docker installed.

### Local Installation

1. **Clone the Repository**
   ```bash
   git clone <repository-url>
   cd "Cold Email"
   ```

2. **Create and Activate a Virtual Environment**
   ```bash
   python -m venv venv
   # On Windows (CMD/PowerShell)
   .\venv\Scripts\activate
   # On macOS/Linux
   source venv/bin/activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Setup Environment Variables**
   Create a `.env` file in the root directory (or edit the existing one):
   ```env
   # Groq API Configuration for AI Extractor
   GROQ_API_KEY=your_groq_api_key_here

   # Application Settings
   PORT=8000
   HOST=0.0.0.0

   # Default SMTP Settings (Optional - can be customized in the UI)
   MAIL_SERVER=smtp.gmail.com
   MAIL_PORT=587
   MAIL_USERNAME=your-email@gmail.com
   MAIL_PASSWORD=your-16-char-app-password
   MAIL_FROM=your-email@gmail.com
   ```

5. **Start the Development Server**
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```
   Open [http://localhost:8000/](http://localhost:8000/) in your web browser.

---

## 🐳 Docker Deployment

The application includes a `Dockerfile` and a `docker-compose.yml` file for quick, reproducible deployments.

1. Ensure your `.env` file is populated.
2. Build and launch the container stack:
   ```bash
   docker-compose up --build -d
   ```
3. The app will be accessible at [http://localhost:8000](http://localhost:8000).
4. Persisted files:
   - Credentials credentials file: mapped to `/app/credentials.json`.
   - Access tokens cache directory: mapped to `/app/tokens/`.

---

## 🔑 Gmail API OAuth Setup (Optional)

To enable authentication using the secure Gmail API channel instead of SMTP:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Gmail API**.
3. Configure the **OAuth Consent Screen** (User Type: *External*, publishing status: *Testing*).
   - Add the OAuth scope: `https://www.googleapis.com/auth/gmail.send`.
   - Add your Gmail account under **Test Users**.
4. Navigate to **Credentials** -> **Create Credentials** -> **OAuth Client ID**.
   - Application Type: **Web application**.
   - Authorized redirect URIs: Add `http://localhost:8000/api/auth/callback` (or your production callback URL).
5. Download the client secret JSON file.
6. Rename it to `credentials.json` and place it in the root folder of your project (or define the path via `GOOGLE_CREDENTIALS_FILE` in your `.env`).
7. In the app's sidebar, change the **Send Method** to **Gmail API** and click **Authenticate Gmail API** to link your account.

---

## 📖 Usage Guide

1. **Upload Files**:
   - **Contacts file**: Upload an Excel (`.xlsx`, `.xls`) or CSV file. It must contain a column for emails. Common column names (e.g., `Email`, `Contact`, `HR Email`) are auto-detected.
   - **Resume PDF**: Upload your resume/attachment (PDF format).
2. **Draft the Template**:
   - Use the dynamically detected placeholder pills (e.g., `{Name}`, `{Company}`, `{Role}`) to inject custom values into your Subject and Body text.
   - Insert formatted text using the rich-text editor controls or custom markdown tags.
3. **Validate & Test**:
   - Inspect the **Live Sample Preview** box.
   - Enable **Dry Run Mode** to perform a zero-risk transmission simulation first.
   - Toggle off **Auto Approval** if you want to verify or customize the body of individual emails before they are dispatched.
4. **Broadcast**:
   - Click **Start Send Job** and watch the real-time progress bar and logs.
