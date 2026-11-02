// Used only when serving the built app with `vite preview` inside the Docker
// image. It forwards /api to the backend — the same job nginx would do.
export default {
  preview: {
    // Vite rejects requests whose Host header it does not recognise (a DNS
    // rebinding defence, GHSA-vg6x-rcgg-rjx6). Only IP literals, localhost and
    // *.localhost pass implicitly, so a real domain gets:
    //
    //   403 Blocked request. This host (...) is not allowed.
    //
    // The trap is that the pods still look healthy: kubelet's probes send
    // `Host: <pod-IP>`, and IPs are always allowed, so readiness passes while
    // every browser gets a 403.
    //
    // A leading dot allows a domain and its subdomains. Never set this to
    // `true` — that turns the check off for every host on the internet.
    allowedHosts: [
      'devboard.trainwithshubham.com',
      '.elb.amazonaws.com',
    ],
    proxy: {
      // There is deliberately NO '/api/ai' rule here.
      //
      // In the cluster the Gateway owns those paths: k8s/httproute.yml matches
      // /api/ai/summarise, /api/ai/ask and /api/ai/health exactly and sends
      // them straight to ai-service, so they never reach this container.
      //
      // A blanket '/api/ai' prefix rule here would be a SECOND, independent
      // route into ai-service that bypasses those Exact matches entirely —
      // which is how /metrics stayed publicly reachable at /api/ai/metrics
      // even after the HTTPRoute was tightened. Two doors, one lock.
      //
      // Anything under /api/ai that the Gateway does not recognise now falls
      // through to the /api rule below and 404s at the Go backend.
      '/api': {
        target: 'http://backend:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
};
