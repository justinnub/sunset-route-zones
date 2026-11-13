/* The page shell. app.js rebuilds index.html from this when you press "Save for everyone". */
window.SWW_SHELL = function (json) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Sunset Valley Route Zones</title>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '<link rel="stylesheet" href="style.css">\n</head>\n<body>\n' +
    '<script id="saved-state" type="application/json">' + json + '<\/script>\n' +
    '<div id="app"></div>\n' +
    '<script src="shell.js"><\/script>\n<script src="data.js"><\/script>\n<script src="stores.js"><\/script>\n<script src="app.js"><\/script>\n' +
    '</body>\n</html>\n';
};
