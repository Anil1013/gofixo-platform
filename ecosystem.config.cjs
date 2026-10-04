module.exports = {
  apps: [
    {
      name: 'gofixo-backend',
      script: './server.js',
      cwd: '/home/ubuntu/gofixo-platform',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
