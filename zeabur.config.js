module.exports = {
  containerPort: 3000,
  setupCommands: ['npm install'],
  startCommand: 'npm start',
  services: [
    {
      name: 'redis',
      type: 'redis:latest',
      port: 6379
    }
  ]
};