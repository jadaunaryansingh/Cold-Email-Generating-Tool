import os
import json
import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from backend.config import GOOGLE_CREDENTIALS_FILE

SCOPES = ['https://www.googleapis.com/auth/gmail.send']
TOKEN_PATH = os.path.join("tokens", "token.json")

class GmailService:
    def __init__(self):
        self.credentials = None
        self._load_token()

    def _load_token(self):
        """
        Loads saved user credentials from token.json.
        """
        if os.path.exists(TOKEN_PATH):
            try:
                self.credentials = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
            except Exception as e:
                print(f"Error loading Gmail token: {e}")
                self.credentials = None

    def is_authenticated(self) -> bool:
        """
        Checks if Gmail token is valid or can be refreshed.
        """
        self._load_token()
        if not self.credentials:
            return False
            
        if self.credentials.expired and self.credentials.refresh_token:
            try:
                self.credentials.refresh(Request())
                with open(TOKEN_PATH, "w") as token:
                    token.write(self.credentials.to_json())
                return True
            except Exception as e:
                print(f"Failed to refresh Gmail credentials: {e}")
                return False
                
        return self.credentials.valid

    def get_auth_url(self, redirect_uri: str) -> tuple:
        """
        Generates Google OAuth authentication URL and state.
        """
        if not os.path.exists(GOOGLE_CREDENTIALS_FILE):
            raise FileNotFoundError(
                f"Google client credentials file '{GOOGLE_CREDENTIALS_FILE}' not found in project root. "
                "Please configure and upload it."
            )
            
        flow = Flow.from_client_secrets_file(
            GOOGLE_CREDENTIALS_FILE,
            scopes=SCOPES,
            redirect_uri=redirect_uri
        )
        auth_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )
        return auth_url, state

    def save_credentials_from_code(self, code: str, redirect_uri: str, state: str):
        """
        Exchanges authorization code for tokens and saves them.
        """
        flow = Flow.from_client_secrets_file(
            GOOGLE_CREDENTIALS_FILE,
            scopes=SCOPES,
            state=state,
            redirect_uri=redirect_uri
        )
        flow.fetch_token(code=code)
        credentials = flow.credentials
        
        # Save token.json
        os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
        with open(TOKEN_PATH, "w") as token:
            token.write(credentials.to_json())
            
        self.credentials = credentials

    def logout(self):
        """
        Logs out user by deleting the token file.
        """
        if os.path.exists(TOKEN_PATH):
            os.remove(TOKEN_PATH)
        self.credentials = None

    def _prepare_body_for_sending(self, body: str) -> tuple:
        """
        Converts bare newlines to <br> and wraps the body in an HTML envelope
        when HTML tags are detected, so line structure is preserved in email clients.
        Returns (mime_body, content_type).
        """
        html_tags = [
            "<html", "<body", "<p>", "<br", "<a ", "<a>",
            "<b>", "</b>", "<i>", "</i>", "<strong", "<em",
            "<ul", "<ol", "<li", "<div", "<span"
        ]
        body_is_html = any(tag in body.lower() for tag in html_tags)

        if body_is_html:
            normalised = body.replace("\r\n", "\n").replace("\r", "\n")
            lines = normalised.split("\n")
            converted_lines = []
            for line in lines:
                stripped = line.strip().lower()
                block_end = any(stripped.endswith(tag) for tag in [
                    "</p>", "</div>", "</li>", "</ul>", "</ol>",
                    "</h1>", "</h2>", "</h3>", "<br>", "<br/>"
                ])
                if block_end:
                    converted_lines.append(line)
                elif stripped == "":
                    # Blank lines = paragraph gaps → emit a <br> so spacing is preserved
                    converted_lines.append("<br>")
                else:
                    converted_lines.append(line + "<br>")
            html_body = "\n".join(converted_lines)
            mime_body = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {{
      font-family: Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #222222;
      margin: 0;
      padding: 0;
    }}
    a {{ color: #1a73e8; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
  </style>
</head>
<body>
{html_body}
</body>
</html>"""
            return mime_body, 'html'
        else:
            return body, 'plain'

    def send_mime_message(self, recipient_email: str, subject: str, body: str, pdf_data: bytes = None, pdf_filename: str = None):
        """
        Assembles a MIME multipart email and broadcasts it using Gmail API.
        """
        if not self.is_authenticated():
            raise Exception("Gmail API is not authenticated. Please log in first.")

        # Build raw MIME message
        msg = MIMEMultipart()
        msg['To'] = recipient_email
        msg['Subject'] = subject

        # Attach Body — convert newlines to <br> when HTML content is present
        mime_body, content_type = self._prepare_body_for_sending(body)
        msg.attach(MIMEText(mime_body, content_type))

        # Attach PDF Resume if present
        if pdf_data and pdf_filename:
            part = MIMEBase('application', 'octet-stream')
            part.set_payload(pdf_data)
            encoders.encode_base64(part)
            part.add_header(
                'Content-Disposition',
                f'attachment; filename="{pdf_filename}"'
            )
            msg.attach(part)

        # Gmail API requires urlsafe base64 encoded raw message string
        raw_msg = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
        
        # Build Gmail service client
        service = build('gmail', 'v1', credentials=self.credentials)
        service.users().messages().send(userId='me', body={'raw': raw_msg}).execute()
