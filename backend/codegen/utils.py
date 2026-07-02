import re


def extract_html_content(text: str) -> str:
    file_match = re.search(
        r"<file\s+path=\"[^\"]+\">\s*(.*?)\s*</file>",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if file_match:
        return extract_html_content(file_match.group(1).strip())

    # First, strip markdown code fences if present
    text = re.sub(r'^```html?\s*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n?```\s*$', '', text, flags=re.MULTILINE)

    # Try to find DOCTYPE + html tags together
    match_with_doctype = re.search(
        r"(<!DOCTYPE\s+html[^>]*>.*?<html.*?>.*?</html>)", text, re.DOTALL | re.IGNORECASE
    )
    if match_with_doctype:
        return match_with_doctype.group(1)

    # Fall back to just <html> tags
    match = re.search(r"(<html.*?>.*?</html>)", text, re.DOTALL)
    if match:
        return match.group(1)
    else:
        # Otherwise, we just send the previous HTML over
        print(
            "[HTML Extraction] No <html> tags found in the generated content"
        )
        return text


def is_renderable_html_document(text: str) -> bool:
    extracted = extract_html_content(text).strip()
    return bool(
        re.search(r"<!DOCTYPE\s+html\b", extracted, re.IGNORECASE)
        or re.search(r"<html\b", extracted, re.IGNORECASE)
    )


def contains_html_markup(text: str) -> bool:
    cleaned = re.sub(r'^```[a-z]*\s*\n?', '', text.strip(), flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r'\n?```\s*$', '', cleaned, flags=re.MULTILINE)
    return bool(re.search(r"<[a-zA-Z][\w:-]*(?:\s[^<>]*)?>", cleaned) or re.search(r"</[a-zA-Z][\w:-]*\s*>", cleaned))
