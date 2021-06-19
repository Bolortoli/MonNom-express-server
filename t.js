import randomEmail from 'random-email';

for (let i = 0; i < 10; i++) {
    console.log(randomEmail({ domain: 'example.com' }))
}