import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const STRAPI_URL = process.env.STRAPI_URL
const router = express.Router();

router.post('/auth/local', async (req, res) => {
	try {
		const {
			identifier,
			password
		} = req.body;
		console.log(identifier)
		console.log(STRAPI_URL)
		const response = axios.post(`${STRAPI_URL}/auth/local`, { identifier, password });
		console.log(`return`)
		console.log(response.data)
		res.send(response.data);
	} catch(e) {
		res.status(400).send({
			message: 'Нэвтрэх нэр эсвэл нууц үг буруу байна'
		})
	}
})

export default router;