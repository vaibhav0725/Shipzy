import cf from 'cloudfront';

const kvs = cf.kvs();

// Viewer-request router: maps the request host to a deployment prefix stored in the KeyValueStore
// ("host:<hostname>" -> "<project>/<deploymentId>") and rewrites the URI so S3 serves that immutable deployment.
//
// How a path becomes a file depends on how the deployment was built, recorded under "mode:<project>/<id>":
//  - no mode (single-page app): paths without a file extension get /index.html, so client-side routing works;
//  - "html" (multi-page static site, e.g. a Next.js export): /about -> /about.html, / -> /index.html, and a trailing
//    slash is redirected away (/about/ -> /about), as Next.js itself does;
//  - "dir" (the same with trailingSlash): /about/ -> /about/index.html, and /about is redirected to /about/.
async function handler(event) {
  var request = event.request;
  var host = request.headers.host.value.toLowerCase();

  var target;
  try {
    target = await kvs.get('host:' + host);
  } catch (err) {
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: { 'content-type': { value: 'text/plain; charset=utf-8' } },
      body: 'No deployment is live for ' + host,
    };
  }

  var mode = '';
  try {
    mode = await kvs.get('mode:' + target);
  } catch (err) {
    mode = '';
  }

  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  var hasExtension = last.indexOf('.') !== -1;

  if (mode === 'html' || mode === 'dir') {
    var endsWithSlash = uri.charAt(uri.length - 1) === '/';
    if (uri !== '/' && ((mode === 'html' && endsWithSlash) || (mode === 'dir' && !endsWithSlash && !hasExtension))) {
      return redirect(mode === 'html' ? uri.substring(0, uri.length - 1) : uri + '/', request.querystring);
    }
    if (endsWithSlash) uri += 'index.html';
    else if (!hasExtension) uri += '.html';
  } else if (last === '' || !hasExtension) {
    uri = '/index.html';
  }

  request.uri = '/' + target + uri;
  return request;
}

function redirect(location, querystring) {
  var parts = [];
  for (var key in querystring) {
    var entry = querystring[key];
    if (entry.multiValue) {
      for (var i = 0; i < entry.multiValue.length; i++) parts.push(key + '=' + entry.multiValue[i].value);
    } else {
      parts.push(key + '=' + entry.value);
    }
  }
  return {
    statusCode: 308,
    statusDescription: 'Permanent Redirect',
    headers: { location: { value: parts.length > 0 ? location + '?' + parts.join('&') : location } },
  };
}
