# MeroShare Automation

Automated workflow using Cypress and GitHub Actions.

## Setup

1. Install dependencies:
    ```bash
    npm install
    ```

2. Configure environment:
   - Copy `.env.example` to `.env`
   - Fill in required credentials

3. Run locally:
    ```bash
    npm run cypress:run
    ```

## GitHub Actions

Configure the following secrets in your repository settings:

- `TELEGRAM_TOKEN`
- `TELEGRAM_CHAT_ID`
- `KITTA`
- `MAX_IPO_PRICE`
- `MEMBERS_INFO`

Refer to `.env.example` for configuration format.

## License

MIT
