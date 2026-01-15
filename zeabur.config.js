module.exports = {
  port: 3000,
  installCommand: 'npm install',
  buildCommand: '',
  startCommand: 'npm start',
  healthCheck: {
    path: '/',
    protocol: 'http',
    port: 3000,
    interval: 30,
    timeout: 10
  },
  services: [
    {
      name: 'redis',
      type: 'redis:latest',
      port: 6379
    }
  ]
};