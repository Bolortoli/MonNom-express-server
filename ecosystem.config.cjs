module.exports = {
    apps : [{
      name   : "monnom-express",
      script : "app.js",
      exec_mode: 'cluster',
      instances: 'max',
    }]
  }
  