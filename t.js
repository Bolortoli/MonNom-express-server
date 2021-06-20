import moment from 'moment';

const now = moment('2021-06-18 12:12:00')
const issuedAt = moment('2021-06-18 12:01:00');
const delta = moment.duration(now.diff(issuedAt));
const minutes = delta.asMinutes();

console.log(minutes)