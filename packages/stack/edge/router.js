import cf from 'cloudfront';

const kvs = cf.kvs();

// Viewer-request router: maps the request host to a deployment prefix stored in
// the KeyValueStore ("host:<hostname>" -> "<project>/<deploymentId>") and
// rewrites the URI so S3 serves that immutable deployment. Paths without a file
// extension fall back to /index.html so client-side routing works.
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

  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last === '' || last.indexOf('.') === -1) {
    uri = '/index.html';
  }

  request.uri = '/' + target + uri;
  return request;
}
