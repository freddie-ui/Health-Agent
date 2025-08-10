export default function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("up");
  if (req.method === "POST") return res.status(200).send("OK");
  return res.status(405).send("Method Not Allowed");
}
