import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import ErrorPage from './errorpage';
import './index.css';
import Root from './root';
import Index from './routes';
import App from './routes/test';

const router = createHashRouter([
    {
        path: '/',
        element: <Root />,
        errorElement: <ErrorPage />,
        children: [
            {
                index: true,
                element: <Index />,
            },
            {
                path: 'test',
                element: <App />,
            }
        ],
    }
]);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>,
);
