import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './routes/test';
import './index.css';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import Root from './root';
import Index from './routes';

const router = createHashRouter([
    {
        path: '/',
        element: <Root />,
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
