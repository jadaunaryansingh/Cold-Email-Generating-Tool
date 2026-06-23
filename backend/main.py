import os
import json
import asyncio
import smtplib
import traceback
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd

from backend.config import PORT, HOST
from backend.services.groq_service import GroqService
from backend.services.gmail_service import GmailService
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

app = FastAPI(title="Cold Email Automator API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Disable caching for static files and index
@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# Initialize Services
groq_service = GroqService()
gmail_service = GmailService()

# Serve static frontend folder (to be populated shortly)
os.makedirs("frontend", exist_ok=True)

@app.get("/")
async def get_index():
    index_path = os.path.join("frontend", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Cold Email Automator: frontend/index.html not found.</h1>")

# Mount directory 'frontend' to '/static' path so files inside are served
app.mount("/static", StaticFiles(directory="frontend"), name="static")

# Helper data cleansing & mapping functions
def normalize_contacts(df: pd.DataFrame):
    normalized_cols = {}
    email_col = None
    name_col = None
    company_col = None
    role_col = None

    for col in df.columns:
        col_clean = str(col).strip().lower()
        normalized_cols[col_clean] = col
        if "email" in col_clean or "mail" in col_clean or "e-mail" in col_clean:
            if not email_col: email_col = col
        elif "name" in col_clean or "contact" in col_clean or "person" in col_clean:
            if not name_col: name_col = col
        elif "company" in col_clean or "organization" in col_clean or "firm" in col_clean or "employer" in col_clean:
            if not company_col: company_col = col
        elif "role" in col_clean or "position" in col_clean or "designation" in col_clean or "title" in col_clean or "job" in col_clean:
            if not role_col: role_col = col

    # Fallback: scan cell values to find a column that looks like it contains emails
    if not email_col:
        for col in df.columns:
            sample = df[col].dropna().astype(str).head(10)
            email_like = sample.str.contains(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', regex=True, na=False)
            if email_like.sum() >= max(1, len(sample) // 2):
                email_col = col
                break

    return {
        "email_col": email_col,
        "name_col": name_col,
        "company_col": company_col,
        "role_col": role_col,
        "all_cols": list(df.columns)
    }

def clean_row_data(row):
    cleaned = {}
    for k, v in row.items():
        if pd.isna(v) or v is None:
            cleaned[str(k)] = ""
        else:
            if isinstance(v, float) and v.is_integer():
                cleaned[str(k)] = str(int(v))
            else:
                cleaned[str(k)] = str(v).strip()
    return cleaned

def extract_name_from_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    local_part = email.split("@")[0]
    # Remove numbers and common symbols (like +tag)
    local_part = "".join([c for c in local_part if c.isalpha() or c in "._-"])
    # Split by dot, underscore, or dash
    parts = []
    for separator in [".", "_", "-"]:
        if separator in local_part:
            parts = local_part.split(separator)
            break
    else:
        parts = [local_part]
    parts = [p for p in parts if p]
    if not parts:
        return ""
    return parts[0].capitalize()

inferred_names_cache = {}

def resolve_name_from_row(row_dict: dict) -> str:
    clean_dict = {str(k).strip().lower(): v for k, v in row_dict.items()}
    name_key = None
    email_key = None
    
    for key in clean_dict:
        k_clean = key.strip().lower()
        if "email" in k_clean or "mail" in k_clean:
            if not email_key:
                email_key = key
        elif "name" in k_clean or "contact" in k_clean or "hr" in k_clean:
            if "company" not in k_clean and "role" not in k_clean and "firm" not in k_clean and "title" not in k_clean:
                if not name_key:
                    name_key = key

    resolved_name = ""
    if name_key and clean_dict[name_key]:
        resolved_name = clean_dict[name_key]
    else:
        # Fallback to email extraction
        email_val = None
        if email_key and clean_dict[email_key] and "@" in str(clean_dict[email_key]):
            email_val = str(clean_dict[email_key]).strip().lower()
        else:
            for key in clean_dict:
                if "@" in str(clean_dict[key]):
                    email_val = str(clean_dict[key]).strip().lower()
                    break
        if email_val:
            if email_val in inferred_names_cache:
                resolved_name = inferred_names_cache[email_val]
            else:
                inferred = ""
                if groq_service.is_configured():
                    inferred = groq_service.infer_name_from_email(email_val)
                resolved_name = inferred or extract_name_from_email(email_val)
                inferred_names_cache[email_val] = resolved_name
    return resolved_name or "Friend"

def substitute_placeholders(text: str, row_dict: dict, convert_newlines: bool = False) -> str:
    import re as _re
    result = text
    clean_dict = {str(k).strip().lower(): v for k, v in row_dict.items()}
    
    # 1. Detect standard columns in the row_dict
    name_key = None
    company_key = None
    role_key = None
    email_key = None
    
    for key in clean_dict:
        k_clean = key.strip().lower()
        if "email" in k_clean or "mail" in k_clean:
            if not email_key:
                email_key = key
        elif "name" in k_clean or "contact" in k_clean or "hr" in k_clean:
            if "company" not in k_clean and "role" not in k_clean and "firm" not in k_clean and "title" not in k_clean:
                if not name_key:
                    name_key = key
        elif "company" in k_clean or "organization" in k_clean or "firm" in k_clean:
            if not company_key:
                company_key = key
        elif "role" in k_clean or "position" in k_clean or "designation" in k_clean or "title" in k_clean:
            if not role_key:
                role_key = key

    # 2. Resolve values
    resolved_name    = resolve_name_from_row(row_dict)
    resolved_company = clean_dict.get(company_key, "") if company_key else ""
    resolved_role    = clean_dict.get(role_key, "")    if role_key    else ""

    # 3. Replace placeholders using case-insensitive regex so {name}/{Name}/{NAME} all work
    def ci_replace(text_in: str, keyword: str, value: str) -> str:
        """Replace {keyword} case-insensitively."""
        if not value:
            return text_in
        return _re.sub(_re.escape("{" + keyword + "}"), value, text_in, flags=_re.IGNORECASE)

    # Standard name aliases
    result = ci_replace(result, "name",      resolved_name)
    result = ci_replace(result, "firstname",  resolved_name)
    result = ci_replace(result, "first_name", resolved_name)

    # Replace actual column-name placeholder too (e.g. {HR Name})
    for col_name in row_dict:
        c_lower = col_name.strip().lower()
        if "name" in c_lower or "contact" in c_lower or "hr" in c_lower:
            if "company" not in c_lower and "role" not in c_lower:
                result = ci_replace(result, col_name, resolved_name)

    # Standard company aliases
    result = ci_replace(result, "company",      resolved_company)
    result = ci_replace(result, "organization",  resolved_company)
    result = ci_replace(result, "firm",          resolved_company)
    for col_name in row_dict:
        c_lower = col_name.strip().lower()
        if "company" in c_lower or "organization" in c_lower or "firm" in c_lower:
            result = ci_replace(result, col_name, resolved_company)

    # Standard role aliases
    result = ci_replace(result, "role",        resolved_role)
    result = ci_replace(result, "position",    resolved_role)
    result = ci_replace(result, "designation", resolved_role)
    result = ci_replace(result, "title",       resolved_role)
    for col_name in row_dict:
        c_lower = col_name.strip().lower()
        if "role" in c_lower or "position" in c_lower or "designation" in c_lower or "title" in c_lower:
            result = ci_replace(result, col_name, resolved_role)

    # 4. Replace any remaining custom placeholders from the spreadsheet row
    for col_name, value in row_dict.items():
        result = ci_replace(result, col_name, str(value))

    # 5. Convert newlines to <br> for HTML emails so line breaks render properly
    if convert_newlines:
        # Only convert if there are HTML tags present (it's being sent as HTML)
        has_html = any(tag in result.lower() for tag in ["<a ", "<b>", "<i>", "<br", "<p>", "<div", "<strong"])
        # Always convert when caller requests it (it will be wrapped in HTML)
        result = result.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>\n")

    return result


HTML_TAGS = [
    "<html", "<body", "<p>", "<br", "<a ", "<a>",
    "<b>", "</b>", "<i>", "</i>", "<strong", "<em",
    "<ul", "<ol", "<li", "<div", "<span"
]

def prepare_body_for_sending(body: str) -> tuple:
    """
    Prepares the email body for sending.
    Returns (mime_body: str, content_type: str) where content_type is 'html' or 'plain'.

    If the body contains any HTML tags we:
      1. Normalise line endings
      2. Convert bare \n to <br> so line structure is preserved in HTML email clients
      3. Wrap in a minimal HTML envelope with a readable font stack
    Otherwise the body is returned as-is with content_type 'plain'.
    """
    body_is_html = any(tag in body.lower() for tag in HTML_TAGS)

    if body_is_html:
        # Normalise line endings first
        normalised = body.replace("\r\n", "\n").replace("\r", "\n")
        # Convert bare newlines to <br> tags (skip lines that already have block-level tags)
        lines = normalised.split("\n")
        converted_lines = []
        for line in lines:
            stripped = line.strip().lower()
            # If the line already ends with a block-level HTML tag, don't add <br>
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

        # Wrap in a clean HTML envelope so email clients render it properly
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


# Endpoints
@app.post("/api/preview")
async def preview_emails(
    excel_file: UploadFile = File(...),
    template_subject: str = Form(""),
    template_body: str = Form("")
):
    try:
        contents = await excel_file.read()
        filename = excel_file.filename
        
        if filename.endswith(".csv"):
            for encoding in ['utf-8', 'latin-1', 'cp1252']:
                try:
                    import io
                    df = pd.read_csv(io.BytesIO(contents), encoding=encoding)
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise HTTPException(status_code=400, detail="Could not parse CSV. Invalid encoding.")
        elif filename.endswith((".xlsx", ".xls")):
            import io
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Invalid spreadsheet type.")
        
        df = df.dropna(how='all')
        meta = normalize_contacts(df)
        if not meta["email_col"]:
            cols_found = ", ".join(f'"{c}"' for c in meta["all_cols"]) if meta["all_cols"] else "none"
            raise HTTPException(
                status_code=400,
                detail=f"No email column found. Columns detected in your sheet: [{cols_found}]. Please add a column named 'Email' (or similar)."
            )
            
        previews = []
        contacts = []
        for index, row in df.iterrows():
            row_dict = clean_row_data(row.to_dict())
            email = row_dict.get(meta["email_col"])
            if not email or "@" not in email:
                continue
                
            contacts.append({
                "index": index + 1,
                "email": email,
                "row_data": row_dict
            })
            
            if len(previews) < 5:
                subject = substitute_placeholders(template_subject, row_dict)
                body = substitute_placeholders(template_body, row_dict)
                
                previews.append({
                    "index": index + 1,
                    "email": email,
                    "subject": subject,
                    "body": body,
                    "row_data": row_dict
                })
            
        return {
            "success": True,
            "detected_email_column": meta["email_col"],
            "detected_name_column": meta["name_col"],
            "detected_company_column": meta["company_col"],
            "detected_role_column": meta["role_col"],
            "all_columns": meta["all_cols"],
            "total_valid_contacts": len(contacts),
            "previews": previews,
            "contacts": contacts
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_assistant(
    message: str = Form(...),
    file: UploadFile = File(None)
):
    """
    Endpoint for Groq Chatbot. Accepts chat string prompt and optional file attachment,
    returning conversational text and extracted contacts list.
    """
    try:
        file_bytes = None
        filename = None
        if file:
            file_bytes = await file.read()
            filename = file.filename
            
        response = groq_service.query_chatbot(
            user_prompt=message,
            file_bytes=file_bytes,
            filename=filename
        )
        return response
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chatbot failed: {str(e)}")

# Google OAuth Endpoints
@app.get("/api/auth/gmail")
async def authenticate_gmail(request: Request):
    """
    Returns Google OAuth URL to redirect the browser to.
    """
    try:
        # Resolve dynamic host from request to construct redirect callback URI
        origin = str(request.base_url).rstrip('/')
        redirect_uri = f"{origin}/api/auth/callback"
        auth_url, state = gmail_service.get_auth_url(redirect_uri)
        
        # Save state in a simple cookie or return it
        response = {"auth_url": auth_url, "state": state}
        return response
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Authentication flow start failure: {str(e)}")

@app.get("/api/auth/callback")
async def gmail_auth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    """
    Receives authorization code from Google redirect and exchanges it for access tokens.
    """
    if error:
        return HTMLResponse(f"<h1>Authentication Canceled</h1><p>{error}</p><a href='/'>Go Back</a>")
    if not code:
        raise HTTPException(status_code=400, detail="Authorization code missing.")
        
    try:
        origin = str(request.base_url).rstrip('/')
        redirect_uri = f"{origin}/api/auth/callback"
        gmail_service.save_credentials_from_code(code, redirect_uri, state)
        
        # Redirect user back to local homepage dashboard
        return RedirectResponse(url="/")
    except Exception as e:
        traceback.print_exc()
        return HTMLResponse(f"<h1>Authentication Failure</h1><p>{str(e)}</p><a href='/'>Go Back</a>")

@app.get("/api/auth/status")
async def get_gmail_auth_status():
    """
    Checks if active Gmail tokens exist.
    """
    try:
        is_auth = gmail_service.is_authenticated()
        return {"authenticated": is_auth}
    except Exception as e:
        return {"authenticated": False, "error": str(e)}

@app.post("/api/auth/logout")
async def logout_gmail():
    """
    Deletes credentials token locally.
    """
    try:
        gmail_service.logout()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/config/smtp")
async def get_smtp_config():
    """
    Returns empty SMTP configuration defaults to ensure user-configured values on the frontend are prioritized.
    """
    return {
        "smtp_server": "",
        "smtp_port": 587,
        "sender_email": "",
        "has_password": False,
        "mail_from": ""
     }

@app.post("/api/send")
async def send_emails(
    excel_file: UploadFile = File(...),
    resume_file: UploadFile = File(None),
    template_subject: str = Form(""),
    template_body: str = Form(""),
    smtp_server: str = Form(None),
    smtp_port: int = Form(None),
    sender_email: str = Form(None),
    sender_password: str = Form(None),
    use_tls: bool = Form(True),
    use_ssl: bool = Form(False),
    send_method: str = Form("smtp"), # "smtp" or "gmail_api"
    dry_run: bool = Form(False),
    delay_seconds: float = Form(2.0)
):
    async def email_sender_generator():
        try:
            excel_contents = await excel_file.read()
            excel_filename = excel_file.filename
            
            if excel_filename.endswith(".csv"):
                import io
                df = pd.read_csv(io.BytesIO(excel_contents))
            else:
                import io
                df = pd.read_excel(io.BytesIO(excel_contents))
                
            df = df.dropna(how='all')
            meta = normalize_contacts(df)
            
            if not meta["email_col"]:
                yield f"data: {json.dumps({'error': 'Email column not found'})}\n\n"
                return
                
            valid_rows = []
            for idx, r in df.iterrows():
                row_dict = clean_row_data(r.to_dict())
                email = row_dict.get(meta["email_col"])
                if email and "@" in str(email):
                    valid_rows.append((idx + 1, email, row_dict))
                    
            total_emails = len(valid_rows)
            yield f"data: {json.dumps({'event': 'start', 'total': total_emails, 'dry_run': dry_run})}\n\n"
            
            resume_data = None
            resume_filename = None
            if resume_file:
                resume_data = await resume_file.read()
                resume_filename = resume_file.filename
                
            # If doing a live send using Gmail API, verify authentication state first
            if not dry_run and send_method == "gmail_api":
                if not gmail_service.is_authenticated():
                    yield f"data: {json.dumps({'error': 'Gmail API token not authenticated. Please log in.'})}\n\n"
                    return

            for idx, (row_num, email, row_dict) in enumerate(valid_rows):
                subject = substitute_placeholders(template_subject, row_dict)
                body = substitute_placeholders(template_body, row_dict)
                
                yield f"data: {json.dumps({'event': 'processing', 'index': idx + 1, 'email': email, 'row': row_num})}\n\n"
                
                if dry_run:
                    await asyncio.sleep(0.5)
                    yield f"data: {json.dumps({
                        'event': 'sent_success', 
                        'index': idx + 1, 
                        'email': email, 
                        'message': '[DRY RUN] Personalised template and resume parsed successfully.',
                        'dry_run': True
                    })}\n\n"
                else:
                    try:
                        if send_method == "gmail_api":
                            # Send via Gmail API OAuth
                            gmail_service.send_mime_message(
                                recipient_email=email,
                                subject=subject,
                                body=body,
                                pdf_data=resume_data,
                                pdf_filename=resume_filename
                            )
                            yield f"data: {json.dumps({
                                'event': 'sent_success', 
                                'index': idx + 1, 
                                'email': email, 
                                'message': 'Email sent successfully via Gmail API!'
                            })}\n\n"
                        else:
                            # Send via traditional SMTP
                            # Use details entered by the user in the frontend Connection Settings
                            current_smtp_server = smtp_server
                            current_smtp_port = smtp_port or 587
                            current_sender_email = sender_email
                            current_sender_password = sender_password
                                
                            current_use_ssl = use_ssl
                            current_use_tls = use_tls

                            if not current_smtp_server or not current_sender_email or not current_sender_password:
                                raise ValueError("SMTP configuration is missing. Please enter your SMTP Server, Port, Sender Email, and Password in the Connection Settings.")

                            msg = MIMEMultipart()
                            msg['From'] = current_sender_email
                            msg['To'] = email
                            msg['Subject'] = subject
                            
                            mime_body, content_type = prepare_body_for_sending(body)
                            msg.attach(MIMEText(mime_body, content_type))
                                
                            if resume_data and resume_filename:
                                part = MIMEBase('application', 'octet-stream')
                                part.set_payload(resume_data)
                                encoders.encode_base64(part)
                                part.add_header(
                                    'Content-Disposition',
                                    f'attachment; filename="{resume_filename}"'
                                )
                                msg.attach(part)
                                
                            server = None
                            try:
                                if current_use_ssl:
                                    server = smtplib.SMTP_SSL(current_smtp_server, current_smtp_port, timeout=15)
                                else:
                                    server = smtplib.SMTP(current_smtp_server, current_smtp_port, timeout=15)
                                if current_use_tls and not current_use_ssl:
                                    server.starttls()
                                    
                                server.login(current_sender_email, current_sender_password)
                                server.sendmail(current_sender_email, email, msg.as_string())
                            finally:
                                if server:
                                    try:
                                        server.quit()
                                    except Exception:
                                        pass
                            
                            yield f"data: {json.dumps({
                                'event': 'sent_success', 
                                'index': idx + 1, 
                                'email': email, 
                                'message': 'Email sent successfully via SMTP!'
                            })}\n\n"
                            
                    except Exception as email_err:
                        yield f"data: {json.dumps({
                            'event': 'sent_failed', 
                            'index': idx + 1, 
                            'email': email, 
                            'error': str(email_err)
                        })}\n\n"
                        
                if idx < total_emails - 1:
                    await asyncio.sleep(delay_seconds)
                    
            yield f"data: {json.dumps({'event': 'complete', 'total': total_emails})}\n\n"
            
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'error': f'System error during operation: {str(e)}'})}\n\n"
            
    return StreamingResponse(email_sender_generator(), media_type="text/event-stream")

@app.post("/api/compile-template")
async def compile_template_endpoint(
    template_subject: str = Form(...),
    template_body: str = Form(...),
    row_data_json: str = Form(...)
):
    try:
        row_dict = json.loads(row_data_json)
        resolved_name = resolve_name_from_row(row_dict)
        subject = substitute_placeholders(template_subject, row_dict)
        body = substitute_placeholders(template_body, row_dict)
        return {
            "success": True,
            "subject": subject,
            "body": body,
            "resolved_name": resolved_name
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/send-single")
async def send_single_email(
    recipient_email: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    row_data_json: str = Form(None),
    resume_file: UploadFile = File(None),
    smtp_server: str = Form(None),
    smtp_port: int = Form(None),
    sender_email: str = Form(None),
    sender_password: str = Form(None),
    use_tls: bool = Form(True),
    use_ssl: bool = Form(False),
    send_method: str = Form("smtp"), # "smtp" or "gmail_api"
    dry_run: bool = Form(False)
):
    try:
        if row_data_json:
            try:
                row_dict = json.loads(row_data_json)
                subject = substitute_placeholders(subject, row_dict)
                body = substitute_placeholders(body, row_dict)
            except Exception:
                pass

        if not dry_run and send_method == "gmail_api":
            if not gmail_service.is_authenticated():
                raise HTTPException(status_code=400, detail="Gmail API token not authenticated. Please log in.")
        
        resume_data = None
        resume_filename = None
        if resume_file:
            resume_data = await resume_file.read()
            resume_filename = resume_file.filename

        if dry_run:
            await asyncio.sleep(0.1)
            return {
                "success": True,
                "message": f"[DRY RUN] Template compiled and email simulated successfully for {recipient_email}."
            }
            
        if send_method == "gmail_api":
            gmail_service.send_mime_message(
                recipient_email=recipient_email,
                subject=subject,
                body=body,
                pdf_data=resume_data,
                pdf_filename=resume_filename
            )
            return {
                "success": True,
                "message": f"Email sent successfully to {recipient_email} via Gmail API!"
            }
        else:
            # Send via traditional SMTP
            # Use details entered by the user in the frontend Connection Settings
            current_smtp_server = smtp_server
            current_smtp_port = smtp_port or 587
            current_sender_email = sender_email
            current_sender_password = sender_password
            
            current_use_ssl = use_ssl
            current_use_tls = use_tls

            if not current_smtp_server or not current_sender_email or not current_sender_password:
                raise ValueError("SMTP configuration is missing. Please enter your SMTP Server, Port, Sender Email, and Password in the Connection Settings.")

            msg = MIMEMultipart()
            msg['From'] = current_sender_email
            msg['To'] = recipient_email
            msg['Subject'] = subject
            
            mime_body, content_type = prepare_body_for_sending(body)
            msg.attach(MIMEText(mime_body, content_type))
                
            if resume_data and resume_filename:
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(resume_data)
                encoders.encode_base64(part)
                part.add_header(
                    'Content-Disposition',
                    f'attachment; filename="{resume_filename}"'
                )
                msg.attach(part)
                
            server = None
            try:
                if current_use_ssl:
                    server = smtplib.SMTP_SSL(current_smtp_server, current_smtp_port, timeout=15)
                else:
                    server = smtplib.SMTP(current_smtp_server, current_smtp_port, timeout=15)
                if current_use_tls and not current_use_ssl:
                    server.starttls()
                    
                server.login(current_sender_email, current_sender_password)
                server.sendmail(current_sender_email, recipient_email, msg.as_string())
            finally:
                if server:
                    try:
                        server.quit()
                    except Exception:
                        pass
            
            return {
                "success": True,
                "message": f"Email sent successfully to {recipient_email} via SMTP!"
            }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
