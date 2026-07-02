from codegen.utils import extract_html_content, is_renderable_html_document


def test_extract_html_content_from_wrapped_file_tag() -> None:
    text = '<file path="index.html">\n<html><body><p>Hello</p></body></html>\n</file>'

    result = extract_html_content(text)

    assert result == "<html><body><p>Hello</p></body></html>"


def test_is_renderable_html_document_only_accepts_html() -> None:
    assert is_renderable_html_document("<!DOCTYPE html><html><body>Hi</body></html>")
    assert is_renderable_html_document("<html><body>Hi</body></html>")
    assert not is_renderable_html_document("已创建一个页面摘要")
    assert not is_renderable_html_document("<div>fragment only</div>")
