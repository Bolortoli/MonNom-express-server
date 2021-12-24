import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const STRAPI_URL = process.env.STRAPI_URL

const router = express.Router();

router.post('/user-saved-books', async (req, res) => {
	try {
		const {
			users_permissions_user, // userId
			book // book id
		} = req.body;
		const userId = req.user.id;
		await axios.post(`${STRAPI_URL}/user-saved-books`, { users_permissions_user: userId, book })
		res.send({
			message: 'success'
		});
	} catch(e) {
		res.status(400).send({
			message: 'Алдаа гарлаа'
		})
	}
})

router.post('/user-saved-podcasts', async (req, res) => {
	try {
		const {
			users_permissions_user,
			podcast_channel
		} = req.body;
		const userId = req.user.id;
		await axios.post(`${STRAPI_URL}/user-saved-podcasts`, {
			users_permissions_user: userId,
			podcast_channel
		})
		res.send({
			message: 'success'
		})
	} catch(e) {
		res.status(400).send({
			message: 'Алдаа гарлаа'
		})
	}
})

router.post('/book-comments', async (req, res) => {
	try {
		const {
			user_name,
			comment,
			user_id,
			book
		} = req.body;
		const userId = req.user.id;
		await axios.post(`${STRAPI_URL}/book-comments`, {
			user_name,
			comment,
			user_id: userId,
			book
		})
		res.send({
			message: 'success'
		})
	} catch(e) {
		res.status(400).send({
			message: 'Алдаа гарлаа'
		})
	}
})

router.post('/podcast-channel-comments', async (req, res) => {
	try {
		const {
			user_name,
			comment,
			user_id,
			podcast_channel
		} = req.body;
		const userId = req.user.id;
		await axios.post(`${STRAPI_URL}/podcast-channel-comments`, {
			user_name,
			comment,
			user_id: userId,
			podcast_channel
		})
		res.send({
			message: 'success'
		})
	} catch(e) {
		res.status(400).send({
			message: 'Алдаа гарлаа'
		})
	}
})

router.get('/settings', async (req, res) => {
	try {
		const response = await axios.get(`${STRAPI_URL}/settings`);
		const { TermsAndConditions } = response.data;
		res.send({
			TermsAndConditions
		})
	} catch(e) {
		res.status(400).send({
			message: 'Алдаа гарлаа'
		})
	}
})

export default router;