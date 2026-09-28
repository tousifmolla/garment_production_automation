/** Web app entry point. Authentication and role checks happen in server calls. */
function doGet(event) {
  if (isExternalOAuthWebCallbackRequest_(event)) {
    return handleExternalOAuthWebCallback_(event);
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
