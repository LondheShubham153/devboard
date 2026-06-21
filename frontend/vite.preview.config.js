// Used only when serving the built app with `vite preview` inside the Docker
// image. It forwards /api to the backend — the same job nginx would do.
export default {
  preview: {
    proxy: {
      '/api': {
        target: 'http://backend:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
};
